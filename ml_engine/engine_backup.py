"""
AI/ML timetable engine.

Pipeline:
CSV -> validation/cleaning -> feature engineering -> synthetic training data
-> model comparison -> ML assignment scores -> MILP constraint optimization
-> timetable validation and quality score.

The ML target is explicitly synthetic because the project has no historical
timetable labels. The optimizer, not the classifier, is responsible for
hard feasibility.
"""
from __future__ import annotations
import argparse, json, math, os, re, sys, traceback
from pathlib import Path
from io import StringIO
from datetime import datetime

import numpy as np
import pandas as pd
import joblib
from scipy.optimize import milp, LinearConstraint, Bounds
from scipy.sparse import coo_matrix
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix, roc_auc_score

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "models"
MODEL_DIR.mkdir(exist_ok=True)
MODEL_PATH = MODEL_DIR / "best_model.joblib"
META_PATH = MODEL_DIR / "model_metadata.json"

DAYS_DEFAULT = ["Monday","Tuesday","Wednesday","Thursday","Friday"]
DAY_INDEX = {d:i for i,d in enumerate(["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"])}
TIME_SLOTS = [(f"{h:02d}:00", f"{h+1:02d}:00") for h in [8,9,10,11,14,15,16,17]]
LAB_STARTS = [0,1,2,4,5,6]  # 2-hour blocks, no lunch overlap

TEACHER_REQUIRED = ["teacher_id","teacher_name"]
STUDENT_REQUIRED = ["division"]
ROOM_REQUIRED = ["room_number","room_type","capacity"]

FEATURES = [
    "teacher_availability","teacher_workload_ratio","student_count",
    "classroom_capacity","capacity_difference","room_availability",
    "subject_frequency","subject_type","day_index","time_slot_index",
    "division_size","daily_student_hours","weekly_student_hours",
    "lab_requirement","equipment_match","teacher_preference_match"
]
CATEGORICAL = ["subject_type"]
NUMERIC = [x for x in FEATURES if x not in CATEGORICAL]

def clean_col(c):
    return re.sub(r"[^a-z0-9_]+","_",str(c).strip().lower()).strip("_")

def norm(s):
    return re.sub(r"\s+"," ",str(s or "").strip())

def parse_bool(x):
    return str(x).strip().lower() in {"1","true","yes","y","on"}

def split_pipe(x):
    return [norm(v) for v in str(x or "").split("|") if norm(v)]

def time_to_min(x):
    m = re.match(r"^(\d{1,2}):(\d{2})$", str(x).strip())
    if not m: return None
    return int(m.group(1))*60+int(m.group(2))

def parse_ranges(value):
    out=[]
    for part in re.split(r"[|;]", str(value or "")):
        part=part.strip()
        if not part: continue
        m=re.match(r"(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})",part)
        if m: out.append((time_to_min(m.group(1)),time_to_min(m.group(2))))
    return out

def range_covers(value, start, end):
    ranges=parse_ranges(value)
    return any(a is not None and b is not None and a<=start and b>=end for a,b in ranges)

def parse_subjects(cell):
    # "DSA:3;DBMS:3" or "DSA,DBMS" accepted.
    parts=re.split(r"[;|]", str(cell or ""))
    out=[]
    for part in parts:
        part=part.strip()
        if not part: continue
        m=re.match(r"(.+?)\s*:\s*(\d+(?:\.\d+)?)$",part)
        if m:
            name=norm(m.group(1)); hours=float(m.group(2))
        else:
            name=norm(part); hours=1.0
        explicit_lab=bool(re.search(r"\[\s*(lab|practical)\s*\]",name,re.I))
        explicit_tut=bool(re.search(r"\[\s*(tutorial|tut)\s*\]",name,re.I))
        stype="Lab" if explicit_lab or re.search(r"\b(lab|practical)\b",name,re.I) else ("Tutorial" if explicit_tut else "Theory")
        name=re.sub(r"\s*\[\s*(lab|practical|tutorial|tut)\s*\]\s*","",name,flags=re.I).strip()
        if stype=="Lab":
            name=re.sub(r"\s+(lab|practical)$","",name,flags=re.I).strip()
        out.append({"name":name,"hours":hours,"type":stype})
    return out

def read_clean_csv(text, required, kind):
    if not str(text or "").strip():
        raise ValueError(f"{kind} CSV is empty.")
    df=pd.read_csv(StringIO(text))
    df.columns=[clean_col(c) for c in df.columns]
    aliases={
        "teacher_id":["id","faculty_id"],
        "teacher_name":["name","faculty_name"],
        "room_number":["room","room_id"],
        "room_type":["type"],
        "student_count":["strength","count","students"],
        "division":["class","section"],
    }
    for target, alts in aliases.items():
        if target not in df.columns:
            for a in alts:
                if a in df.columns:
                    df[target]=df[a]; break
    missing=[c for c in required if c not in df.columns]
    if missing: raise ValueError(f"{kind} CSV missing required columns: {', '.join(missing)}")
    before=len(df)
    missing_cells=int(df.isna().sum().sum())
    dup=int(df.duplicated().sum())
    df=df.drop_duplicates().copy()
    # Conservative cleaning: fill optional text, coerce known numerics.
    numeric_cols=[c for c in ["capacity","max_hours_per_week","student_count","academic_hours_required","roll_number"] if c in df.columns]
    for c in numeric_cols:
        df[c]=pd.to_numeric(df[c],errors="coerce")
        if df[c].isna().any():
            df[c]=df[c].fillna(df[c].median() if not df[c].dropna().empty else 0)
    for c in df.columns:
        if df[c].dtype=="object":
            df[c]=df[c].fillna("")
    # Remove only clearly invalid rows.
    invalid=0
    if kind=="Classroom":
        bad=(df["capacity"]<=0)|(df["room_number"].astype(str).str.strip()=="")
        invalid=int(bad.sum()); df=df.loc[~bad].copy()
    elif kind=="Teacher":
        bad=(df["teacher_name"].astype(str).str.strip()=="")|(df["teacher_id"].astype(str).str.strip()=="")
        invalid=int(bad.sum()); df=df.loc[~bad].copy()
    elif kind=="Student":
        bad=df["division"].astype(str).str.strip()==""
        invalid=int(bad.sum()); df=df.loc[~bad].copy()
    # IQR outlier count is reported, not blindly deleted.
    outliers=0
    for c in numeric_cols:
        s=df[c].dropna()
        if len(s)>=4:
            q1,q3=s.quantile([.25,.75]); iqr=q3-q1
            if iqr>0: outliers += int(((s<q1-1.5*iqr)|(s>q3+1.5*iqr)).sum())
    report={"kind":kind,"rows_before":before,"rows_after":len(df),
            "missing_values":missing_cells,"duplicates":dup,"invalid_records":invalid,
            "outliers_detected":outliers,"columns_processed":list(df.columns),
            "cleaned_csv":df.to_csv(index=False)}
    return df,report

def parse_config(config):
    c=config or {}
    days=c.get("working_days") or DAYS_DEFAULT
    days=[d for d in days if d in DAY_INDEX and d!="Sunday"]
    if not days: days=DAYS_DEFAULT[:]
    hours=int(c.get("hours_per_day") or 5)
    hours=max(1,min(10,hours))
    return {"working_days":days,"hours_per_day":hours,
            "division_settings":c.get("division_settings") or {}}

def division_records(students):
    records=[]
    for div,g in students.groupby("division",dropna=False):
        div=norm(div)
        count=0
        if "student_count" in g.columns:
            count=max(1,int(pd.to_numeric(g["student_count"],errors="coerce").fillna(0).max()))
        if count<=0:
            count=max(1,len(g))
        subjects=[]
        for cell in g.get("subjects",pd.Series([""]*len(g))):
            subjects += parse_subjects(cell)
        # deduplicate while retaining largest requested hours
        sm={}
        for s in subjects: sm[s["name"]]=(max(sm.get(s["name"],0),s["hours"]),s["type"])
        if not sm:
            sm={"Data Structures":(3,"Theory"),"Database Systems":(3,"Theory"),
                "Machine Learning":(3,"Theory"),"Computer Networks":(3,"Theory")}
        specs=[{"name":k,"hours":v[0],"type":v[1]} for k,v in sm.items()]
        records.append({"division":div,"student_count":count,"subjects":specs,
                        "academic_hours_required":float(pd.to_numeric(g.get("academic_hours_required",pd.Series([0])),errors="coerce").fillna(0).max())})
    return records

def clean_training_frame(raw):
    x=raw.copy()
    x["teacher_availability"]=x["teacher_availability"].astype(float)
    x["room_availability"]=x["room_availability"].astype(float)
    x["capacity_difference"]=x["classroom_capacity"]-x["student_count"]
    return x[FEATURES]

def build_synthetic_training(teachers, students, rooms, config, seed=42, n_per=12, max_rows=60000):
    """Build bounded synthetic training data from real uploaded resources.

    Large colleges can have hundreds of faculty and many room/division/subject
    combinations. Exhaustively multiplying every combination can create millions
    of rows and make local training impractical. We therefore sample from the
    real candidate space with a deterministic cap while preserving both feasible
    and infeasible examples.
    """
    rng=np.random.default_rng(seed)
    divs=division_records(students)
    subjects=sorted({s["name"] for d in divs for s in d["subjects"]}) or ["Data Structures"]
    base=[]
    for d in divs:
        for subj in subjects:
            for t in teachers.itertuples():
                for r in rooms.itertuples():
                    base.append((d,subj,t,r))
    if not base:
        raise ValueError("Unable to create synthetic training candidates from the uploaded data.")
    target=max(2000, min(max_rows, len(base)*n_per))
    # Sample base combinations with replacement so training size stays bounded.
    choices=rng.integers(0,len(base),size=target)
    rows=[]
    for idx in choices:
        d,subj,t,r=base[int(idx)]
        day=str(rng.choice(config["working_days"]))
        slot=int(rng.integers(0,len(TIME_SLOTS)))
        start=time_to_min(TIME_SLOTS[slot][0]); end=time_to_min(TIME_SLOTS[slot][1])
        teacher_av=1 if teacher_available(t,day,start,end) else 0
        room_av=1 if room_available(r,day,start,end) else 0
        stype="Lab" if "lab" in subj.lower() or "practical" in subj.lower() else "Theory"
        capdiff=float(r.capacity-d["student_count"])
        lab_req=1 if stype=="Lab" else 0
        equipment=1 if (not lab_req or parse_bool(getattr(r,"has_lab",0))) else 0
        pref=teacher_preference(t,day,start,end)
        workload_ratio=float(rng.uniform(0.05,.9))
        subj_freq=next((s["hours"] for s in d["subjects"] if s["name"]==subj),1)
        feasible=int(teacher_av and room_av and capdiff>=0 and (not lab_req or str(r.room_type).lower()=="lab") and equipment)
        quality=(2.2*teacher_av+1.7*room_av+1.8*(capdiff>=0)+1.5*equipment+1.2*pref+0.8*(1-workload_ratio)+0.4*(day in config["working_days"]))
        label=int(feasible and quality>=5.0)
        if rng.random()<.04: label=1-label
        rows.append([teacher_av,workload_ratio,d["student_count"],r.capacity,capdiff,room_av,subj_freq,stype,DAY_INDEX.get(day,0),slot,d["student_count"],float(d["academic_hours_required"] or sum(s["hours"] for s in d["subjects"])),float(sum(s["hours"] for s in d["subjects"])),lab_req,equipment,pref,label])
    cols=FEATURES+["assignment_feasible"]
    frame=pd.DataFrame(rows,columns=cols)
    # Guarantee both classes for robust train/validation/test splits.
    if frame["assignment_feasible"].nunique()<2:
        frame.loc[0,"assignment_feasible"]=0
        frame.loc[1,"assignment_feasible"]=1
    return frame

def make_pipeline(model):
    pre=ColumnTransformer([
        ("num",Pipeline([("imp",SimpleImputer(strategy="median")),("scale",StandardScaler())]),NUMERIC),
        ("cat",Pipeline([("imp",SimpleImputer(strategy="most_frequent")),
                         ("onehot",OneHotEncoder(handle_unknown="ignore"))]),CATEGORICAL)
    ])
    return Pipeline([("preprocess",pre),("model",model)])

def train_models(teachers,students,rooms,config):
    frame=build_synthetic_training(teachers,students,rooms,config)
    X=frame[FEATURES]; y=frame["assignment_feasible"].astype(int)
    # Deterministic 70/15/15 split.
    rng=np.random.default_rng(42)
    idx=np.arange(len(frame)); rng.shuffle(idx)
    n=len(idx); ntr=max(1,int(n*.70)); nval=max(1,int(n*.15))
    train_idx=idx[:ntr]; val_idx=idx[ntr:ntr+nval]; test_idx=idx[ntr+nval:]
    if len(np.unique(y.iloc[train_idx]))<2:
        raise ValueError("Synthetic training data contains only one class; add more varied teachers/rooms.")
    models={
        "Decision Tree":DecisionTreeClassifier(max_depth=8,min_samples_leaf=3,random_state=42,class_weight="balanced"),
        "Random Forest":RandomForestClassifier(n_estimators=160,max_depth=10,min_samples_leaf=2,random_state=42,n_jobs=-1,class_weight="balanced"),
        "Gradient Boosting":GradientBoostingClassifier(random_state=42,n_estimators=120,max_depth=3)
    }
    results=[]
    fitted={}
    for name,model in models.items():
        pipe=make_pipeline(model); pipe.fit(X.iloc[train_idx],y.iloc[train_idx])
        pv=pipe.predict(X.iloc[val_idx])
        results.append({"model":name,"accuracy":float(accuracy_score(y.iloc[val_idx],pv)),
                        "precision":float(precision_score(y.iloc[val_idx],pv,zero_division=0)),
                        "recall":float(recall_score(y.iloc[val_idx],pv,zero_division=0)),
                        "f1":float(f1_score(y.iloc[val_idx],pv,zero_division=0))})
        fitted[name]=pipe
    best_name=max(results,key=lambda r:(r["f1"],r["accuracy"]))["model"]
    best=fitted[best_name]
    pt=best.predict(X.iloc[test_idx])
    prob=best.predict_proba(X.iloc[test_idx])[:,1] if hasattr(best,"predict_proba") else pt
    cm=confusion_matrix(y.iloc[test_idx],pt).tolist()
    test_metrics={"accuracy":float(accuracy_score(y.iloc[test_idx],pt)),
                  "precision":float(precision_score(y.iloc[test_idx],pt,zero_division=0)),
                  "recall":float(recall_score(y.iloc[test_idx],pt,zero_division=0)),
                  "f1":float(f1_score(y.iloc[test_idx],pt,zero_division=0)),
                  "roc_auc":float(roc_auc_score(y.iloc[test_idx],prob)) if len(np.unique(y.iloc[test_idx]))>1 else None,
                  "confusion_matrix":cm}
    joblib.dump(best,MODEL_PATH)
    # Actual feature importance after preprocessing.
    model_obj=best.named_steps["model"]; pre=best.named_steps["preprocess"]
    names=list(pre.get_feature_names_out())
    importances=getattr(model_obj,"feature_importances_",np.zeros(len(names)))
    fi=sorted([{"feature":n.replace("num__","").replace("cat__",""),"importance":float(v)} for n,v in zip(names,importances)],
              key=lambda z:z["importance"],reverse=True)[:20]
    meta={"model_version":"1.0","trained_at":datetime.now().isoformat(timespec="seconds"),
          "dataset_label":"Synthetic Training Data","rows":int(len(frame)),
          "train_rows":int(len(train_idx)),"validation_rows":int(len(val_idx)),"test_rows":int(len(test_idx)),
          "models":results,"best_model":best_name,"test_metrics":test_metrics,
          "feature_importance":fi,"features":FEATURES}
    META_PATH.write_text(json.dumps(meta,indent=2),encoding="utf-8")
    return meta

def teacher_available(t,day,start,end):
    unavailable_days=set(split_pipe(getattr(t,"unavailable_days","")))
    if day in unavailable_days: return False
    us=split_pipe(getattr(t,"unavailable_slots",""))
    if any(range_covers(v,start,end) for v in us): return False
    allowed=split_pipe(getattr(t,"preferred_days",""))
    slots=split_pipe(getattr(t,"preferred_time_slots",""))
    # Preferred fields are soft; explicit unavailable fields are hard.
    return True

def teacher_preference(t,day,start,end):
    score=0.0
    days=set(split_pipe(getattr(t,"preferred_days","")))
    if days: score += .5 if day in days else 0
    slots=split_pipe(getattr(t,"preferred_time_slots",""))
    if slots and any(range_covers(v,start,end) for v in slots): score += .5
    return min(1.0,score)

def room_available(r,day,start,end):
    days=set(split_pipe(getattr(r,"available_days","")))
    if days and day not in days: return False
    slots=split_pipe(getattr(r,"available_slots",""))
    return not slots or any(range_covers(v,start,end) for v in slots)

def room_ok(r,stype,student_count):
    if int(getattr(r,"capacity",0)) < student_count: return False
    if stype=="Lab" and str(getattr(r,"room_type","")).lower()!="lab": return False
    return True

def ensure_model(teachers,students,rooms,config):
    if not MODEL_PATH.exists() or not META_PATH.exists():
        return train_models(teachers,students,rooms,config)
    try: return json.loads(META_PATH.read_text(encoding="utf-8"))
    except Exception: return train_models(teachers,students,rooms,config)

def candidate_frame(cands):
    return pd.DataFrame(cands)[FEATURES]

def candidate_generation(teachers,students,rooms,config,model):
    divs=division_records(students)
    tasks=[]
    tid=0
    for d in divs:
        for subj in d["subjects"]:
            hours=float(subj["hours"]); stype=subj["type"]
            duration=2 if stype=="Lab" else 1
            count=max(1,int(math.ceil(hours/duration)))
            for k in range(count):
                # A lab is a two-hour practical; theory/tutorial is one hour.
                tasks.append({"task_id":f"{d['division']}|{subj['name']}|{k+1}",
                              "division":d["division"],"student_count":d["student_count"],
                              "subject":subj["name"],"subject_type":stype,"duration":duration})
                tid+=1
    cands=[]
    for task in tasks:
        division_cfg=config["division_settings"].get(task["division"], {})
        division_days=int(division_cfg.get("days_per_week", len(config["working_days"])) or len(config["working_days"]))
        allowed_days=config["working_days"][:max(1,min(len(config["working_days"]),division_days))]
        for day in allowed_days:
            starts=LAB_STARTS if task["duration"]==2 else list(range(len(TIME_SLOTS)))
            for si in starts:
                start=time_to_min(TIME_SLOTS[si][0])
                end=start+task["duration"]*60
                if end>time_to_min("18:00"): continue
                for t in teachers.itertuples():
                    if not teacher_available(t,day,start,end): continue
                    for r in rooms.itertuples():
                        if not room_ok(r,task["subject_type"],task["student_count"]): continue
                        if not room_available(r,day,start,end): continue
                        # ML features are constructed for each real candidate.
                        subj_freq=next((s["hours"] for d in divs if d["division"]==task["division"] for s in d["subjects"] if s["name"]==task["subject"]),1)
                        pref=teacher_preference(t,day,start,end)
                        max_hours=float(getattr(t,"max_hours_per_week",18) or 18)
                        workload_ratio=min(1.0, float(subj_freq)/max_hours)
                        equipment=1 if task["subject_type"]!="Lab" or parse_bool(getattr(r,"has_lab",0)) or str(getattr(r,"room_type","")).lower()=="lab" else 0
                        row={"teacher_availability":1,"teacher_workload_ratio":workload_ratio,
                             "student_count":task["student_count"],"classroom_capacity":int(r.capacity),
                             "capacity_difference":int(r.capacity)-task["student_count"],"room_availability":1,
                             "subject_frequency":float(subj_freq),"subject_type":task["subject_type"],
                             "day_index":DAY_INDEX.get(day,0),"time_slot_index":si,
                             "division_size":task["student_count"],"daily_student_hours":config["hours_per_day"],
                             "weekly_student_hours":sum(s["hours"] for d in divs if d["division"]==task["division"] for s in d["subjects"]),
                             "lab_requirement":1 if task["subject_type"]=="Lab" else 0,
                             "equipment_match":equipment,"teacher_preference_match":pref}
                        cands.append({**task,"day":day,"start_index":si,
                                      "time":f"{TIME_SLOTS[si][0]}–{TIME_SLOTS[si+task['duration']-1][1]}",
                                      "teacher_id":str(t.teacher_id),"teacher_name":str(t.teacher_name),
                                      "teacher_max_hours":float(getattr(t,"max_hours_per_week",18) or 18),
                                      "room_number":str(r.room_number),"features":row})
    if not cands: raise ValueError("No feasible candidate assignments exist after availability, capacity and room-type filtering.")
    X=pd.DataFrame([c["features"] for c in cands])[FEATURES]
    probs=model.predict_proba(X)[:,1]
    for c,p in zip(cands,probs):
        c["ml_score"]=float(p)
    # Keep top candidates per task to make the MILP compact while retaining
    # diversity across days/rooms/teachers.
    grouped={}
    for c in cands: grouped.setdefault(c["task_id"],[]).append(c)
    compact=[]
    for task_id,arr in grouped.items():
        arr=sorted(arr,key=lambda x:(x["ml_score"],teacher_preference_by_candidate(x)),reverse=True)
        compact.extend(arr[:120])
    return tasks,compact

def teacher_preference_by_candidate(c):
    return float(c["features"]["teacher_preference_match"])

def build_milp(tasks,cands,config):
    if not cands: raise ValueError("No candidate assignments.")
    idx={i:c for i,c in enumerate(cands)}
    rows=[]; cols=[]; data=[]; lb=[]; ub=[]; rowno=0
    def add_group(items, lo, hi):
        nonlocal rowno
        for i in items: rows.append(rowno); cols.append(i); data.append(1.0)
        lb.append(lo); ub.append(hi); rowno+=1
    by_task={}
    for i,c in idx.items(): by_task.setdefault(c["task_id"],[]).append(i)
    for t in tasks: add_group(by_task.get(t["task_id"],[]),1,1)
    # resource conflicts by hour
    resources={}
    for i,c in idx.items():
        slots=range(c["start_index"],c["start_index"]+c["duration"])
        for si in slots:
            key=("teacher",c["teacher_id"],c["day"],si); resources.setdefault(key,[]).append(i)
            key=("room",c["room_number"],c["day"],si); resources.setdefault(key,[]).append(i)
            key=("division",c["division"],c["day"],si); resources.setdefault(key,[]).append(i)
    for items in resources.values(): add_group(items,0,1)
    # daily hours per division
    divday={}
    for i,c in idx.items(): divday.setdefault((c["division"],c["day"]),[]).append((i,c["duration"]))
    for key,items in divday.items():
        for i,dur in items: rows.append(rowno); cols.append(i); data.append(float(dur))
        div=key[0]; limit=int(config["division_settings"].get(div,{}).get("hours_per_day",config["hours_per_day"]))
        lb.append(0); ub.append(limit); rowno+=1
    # teacher weekly hours
    tw={}
    for i,c in idx.items(): tw.setdefault(c["teacher_id"],[]).append((i,c["duration"]))
    for tid,items in tw.items():
        maxh=max(float(idx[i].get("teacher_max_hours",18) or 18) for i,_ in items)
        for i,dur in items: rows.append(rowno); cols.append(i); data.append(float(dur))
        lb.append(0); ub.append(maxh); rowno+=1
    A=coo_matrix((data,(rows,cols)),shape=(rowno,len(cands))).tocsr()
    # Maximize ML suitability plus preference, compactness proxy, and capacity fit.
    objective=[]
    for c in cands:
        capfit=min(1.0,max(0.0,c["features"]["capacity_difference"]/max(1,c["features"]["student_count"])))
        score=100*c["ml_score"]+8*c["features"]["teacher_preference_match"]+4*capfit-0.8*c["start_index"]
        objective.append(-score)
    result=milp(c=np.array(objective),integrality=np.ones(len(cands)),bounds=Bounds(0,1),
                constraints=LinearConstraint(A,np.array(lb),np.array(ub)),
                options={"time_limit":30})
    if not result.success:
        raise ValueError(f"Constraint optimization did not find a feasible solution: {result.message}")
    chosen=[cands[i] for i,v in enumerate(result.x) if v>.5]
    return chosen

def validate_schedule(chosen,config,divs):
    conflicts=[]
    used=set()
    for c in chosen:
        for si in range(c["start_index"],c["start_index"]+c["duration"]):
            for kind,key in [("Teacher",c["teacher_id"]),("Room",c["room_number"]),("Division",c["division"])]:
                k=(kind,key,c["day"],si)
                if k in used:
                    conflicts.append({"severity":"high","category":"Conflict","title":f"{kind} conflict",
                                      "detail":f"{key} is double-booked on {c['day']} at slot {si}."})
                used.add(k)
    # required hours
    for d in divs:
        expected=sum(s["hours"] for s in d["subjects"])
        actual=sum(c["duration"] for c in chosen if c["division"]==d["division"])
        if actual+1e-6<expected:
            conflicts.append({"severity":"high","category":"Weekly hours",
                              "title":"Weekly hours not satisfied",
                              "detail":f"{d['division']} requires {expected:g} hours but received {actual:g}."})
    return conflicts

def quality_score(chosen,config,conflicts):
    if not chosen: return 0.0
    hard=max(0,len(conflicts))
    ml=np.mean([c["ml_score"] for c in chosen])*100
    pref=np.mean([c["features"]["teacher_preference_match"] for c in chosen])*100
    capacity=np.mean([min(1,max(0,c["features"]["capacity_difference"]/max(1,c["student_count"]))) for c in chosen])*100
    score=0.60*ml+0.20*pref+0.20*capacity
    return float(max(0,min(100,score if hard==0 else score*max(0,1-hard/len(chosen)))))

def generate(teachers,students,rooms,config):
    meta=ensure_model(teachers,students,rooms,config)
    model=joblib.load(MODEL_PATH)
    tasks,cands=candidate_generation(teachers,students,rooms,config,model)
    chosen=build_milp(tasks,cands,config)
    divs=division_records(students)
    conflicts=validate_schedule(chosen,config,divs)
    sessions=[]
    for c in sorted(chosen,key=lambda x:(DAY_INDEX.get(x["day"],99),x["start_index"],x["division"])):
        sessions.append({"day":c["day"],"time":c["time"],"subject":c["subject"],
                         "faculty":c["teacher_name"],"room":c["room_number"],
                         "division":c["division"],"status":"draft",
                         "classType":c["subject_type"],"batch":None,
                         "batchSize":c["student_count"],"mlScore":round(c["ml_score"]*100,2)})
    return {"sessions":sessions,"conflicts":conflicts,"quality_score":quality_score(chosen,config,conflicts),
            "model":meta,"candidate_count":len(cands),"task_count":len(tasks)}

def inspect(teachers,students,rooms,config):
    reports=[]
    # read_clean_csv already generated reports externally.
    divs=division_records(students)
    subject_counts={}
    for d in divs:
        for s in d["subjects"]: subject_counts[s["name"]]=subject_counts.get(s["name"],0)+s["hours"]
    return {"divisions":[{"division":d["division"],"student_count":d["student_count"],
                           "subjects":len(d["subjects"]),"weekly_hours":sum(s["hours"] for s in d["subjects"])} for d in divs],
            "subject_frequency":subject_counts,
            "student_distribution":{d["division"]:d["student_count"] for d in divs},
            "teacher_workload":{str(r.teacher_name):float(getattr(r,"max_hours_per_week",18) or 18) for r in teachers.itertuples()},
            "room_capacity":{str(r.room_number):int(r.capacity) for r in rooms.itertuples()},
            "working_days":config["working_days"],"hours_per_day":config["hours_per_day"]}

def parse_payload(payload):
    config=parse_config(payload.get("config"))
    teachers,trep=read_clean_csv(payload.get("teachers_csv",""),TEACHER_REQUIRED,"Teacher")
    students,srep=read_clean_csv(payload.get("students_csv",""),STUDENT_REQUIRED,"Student")
    rooms,rrep=read_clean_csv(payload.get("classrooms_csv",""),ROOM_REQUIRED,"Classroom")
    # Normalize key optional columns.
    for c in ["max_hours_per_week"]:
        if c not in teachers.columns: teachers[c]=18
    for c in ["unavailable_days","unavailable_slots","preferred_days","preferred_time_slots"]:
        if c not in teachers.columns: teachers[c]=""
    for c in ["student_count","subjects","academic_hours_required"]:
        if c not in students.columns:
            students[c]=0 if c!="subjects" else ""
    for c in ["available_days","available_slots","has_lab","has_projector","has_computer"]:
        if c not in rooms.columns: rooms[c]="" if c in ["available_days","available_slots"] else 0
    teachers["max_hours_per_week"]=pd.to_numeric(teachers["max_hours_per_week"],errors="coerce").fillna(18)
    rooms["capacity"]=pd.to_numeric(rooms["capacity"],errors="coerce").fillna(0).astype(int)
    students["student_count"]=pd.to_numeric(students["student_count"],errors="coerce").fillna(0).astype(int)
    return teachers,students,rooms,config,{"teachers":trep,"students":srep,"classrooms":rrep}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("command",choices=["inspect","train","generate"])
    args=ap.parse_args()
    try:
        payload=json.load(sys.stdin)
        teachers,students,rooms,config,reports=parse_payload(payload)
        if args.command=="inspect":
            out={"ok":True,"data_quality":reports,"analytics":inspect(teachers,students,rooms,config)}
        elif args.command=="train":
            meta=train_models(teachers,students,rooms,config)
            out={"ok":True,"data_quality":reports,"model":meta}
        else:
            result=generate(teachers,students,rooms,config)
            out={"ok":True,"data_quality":reports,**result}
        print(json.dumps(out,default=lambda x: x.item() if hasattr(x,"item") else str(x)))
    except Exception as e:
        print(json.dumps({"ok":False,"error":str(e),"trace":traceback.format_exc()}))
        sys.exit(1)

if __name__=="__main__":
    main()
