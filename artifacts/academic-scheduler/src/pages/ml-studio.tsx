import { useMemo, useState } from 'react';
import { BrainCircuit, CheckCircle2, Download, FileUp, Gauge, Play, Settings2, Sparkles, UploadCloud } from 'lucide-react';
import { Button, MetricCard, PageIntro, SectionHeading, StatusPill } from '@/components/primitives';

type UploadState = { name: string; text: string; rows: number };
type Result = any;

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function readFile(file: File): Promise<string> {
  return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(String(r.result||'')); r.onerror=()=>reject(r.error); r.readAsText(file); });
}

function DownloadButton({ label, text, filename }: { label:string; text?:string; filename:string; key?:string }) {
  if (!text) return null;
  const href = `data:text/csv;charset=utf-8,${encodeURIComponent(text)}`;
  return <a href={href} download={filename} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[11px] font-bold hover:border-primary/40"><Download size={13}/>{label}</a>;
}

export default function MLStudio() {
  const [files,setFiles]=useState<Record<string,UploadState>>({});
  const [config,setConfig]=useState({days:['Monday','Tuesday','Wednesday','Thursday','Friday'],hours:5,divisionSettings:{} as Record<string,{days:number;hours:number}>});
  const [quality,setQuality]=useState<any>(null);
  const [model,setModel]=useState<any>(null);
  const [result,setResult]=useState<Result>(null);
  const [analytics,setAnalytics]=useState<any>(null);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');

  const ready = Boolean(files.teachers && files.students && files.classrooms);

  async function setCsv(kind:string,file?:File) {
    if (!file) return;
    try {
      const text=await readFile(file);
      const rows=Math.max(0,text.trim().split(/\r?\n/).length-1);
      setFiles(prev=>({...prev,[kind]:{name:file.name,text,rows}}));
      setError('');
    } catch { setError(`Could not read ${file.name}.`); }
  }

  function payload() {
    return {
      teachers_csv:files.teachers?.text || '',
      students_csv:files.students?.text || '',
      classrooms_csv:files.classrooms?.text || '',
      config:{working_days:config.days,hours_per_day:config.hours,division_settings:Object.fromEntries(Object.entries(config.divisionSettings).map(([k,v])=>[k,{days_per_week:(v as {days:number;hours:number}).days,hours_per_day:(v as {days:number;hours:number}).hours}]))},
    };
  }

  async function api(url:string, method='POST', body?:any) {
    const r=await fetch(url,{method,credentials:'include',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
    const data=await r.json().catch(()=>null);
    if(!r.ok) throw new Error(data?.error || `Request failed (${r.status})`);
    return data;
  }

  async function inspect() {
    if(!ready) return setError('Upload all three CSV datasets first.');
    setBusy('inspect'); setError('');
    try { const d=await api('/api/ml/inspect','POST',payload()); setQuality(d.data_quality); setAnalytics(d.analytics); }
    catch(e){setError(e instanceof Error?e.message:'Inspection failed.');} finally{setBusy('');}
  }

  async function train() {
    if(!ready) return setError('Upload all three CSV datasets first.');
    setBusy('train'); setError('');
    try { const d=await api('/api/ml/train','POST',payload()); setQuality(d.data_quality); setModel(d.model); setAnalytics((await api('/api/ml/inspect','POST',payload())).analytics); }
    catch(e){setError(e instanceof Error?e.message:'Training failed.');} finally{setBusy('');}
  }

  async function generate() {
    if(!ready) return setError('Upload all three CSV datasets first.');
    setBusy('generate'); setError('');
    try { const d=await api('/api/ml/generate','POST',payload()); setQuality(d.data_quality); setModel(d.model); setResult(d); setAnalytics((await api('/api/ml/inspect','POST',payload())).analytics); }
    catch(e){setError(e instanceof Error?e.message:'Generation failed.');} finally{setBusy('');}
  }

  async function loadSample() {
    setBusy('sample'); setError('');
    try {
      const d=await api('/api/ml/sample','GET');
      setFiles({
        teachers:{name:'sample teachers.csv',text:d.teachers_csv,rows:Math.max(0,d.teachers_csv.trim().split(/\r?\n/).length-1)},
        students:{name:'sample students.csv',text:d.students_csv,rows:Math.max(0,d.students_csv.trim().split(/\r?\n/).length-1)},
        classrooms:{name:'sample classrooms.csv',text:d.classrooms_csv,rows:Math.max(0,d.classrooms_csv.trim().split(/\r?\n/).length-1)}
      });
      setConfig({days:d.config.working_days,hours:d.config.hours_per_day,divisionSettings:{}});
      const inspected=await api('/api/ml/inspect','POST',d);
      setQuality(inspected.data_quality); setAnalytics(inspected.analytics);
    } catch(e){setError(e instanceof Error?e.message:'Could not load sample data.');} finally{setBusy('');}
  }

  const metric = model?.test_metrics;
  const best = model?.best_model;
  const comparison = model?.models || [];

  return <div className="animate-rise-in">
    <PageIntro eyebrow="Admin · Machine Learning" title="AI/ML Timetable Studio" description="Data → cleaning → preprocessing → feature engineering → ML scoring → constraint optimization → timetable evaluation." action={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={loadSample} disabled={busy==='sample'}><Sparkles size={14}/> {busy==='sample'?'Loading…':'Load Sample Dataset'}</Button><Button onClick={generate} disabled={!ready||busy==='generate'}><Play size={14}/> {busy==='generate'?'Optimizing…':'Generate Timetable'}</Button></div>} />

    {error && <div className="mb-5 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs font-semibold text-destructive">{error}</div>}

    <section className="mb-6 rounded-2xl border border-border bg-card p-5">
      <SectionHeading title="1 · Upload the three datasets" description="CSV files are validated and cleaned before ML processing. Synthetic training labels are clearly separated from your uploaded institutional data." />
      <div className="grid gap-4 md:grid-cols-3">
        {[
          ['teachers','Teachers Data','teachers.csv'],
          ['students','Students / Division Data','students.csv'],
          ['classrooms','Classroom Data','classrooms.csv'],
        ].map(([key,label,example])=><label key={key} className="group cursor-pointer rounded-xl border border-dashed border-border p-4 transition hover:border-primary/50 hover:bg-primary/5">
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={e=>setCsv(key,e.target.files?.[0])}/>
          <div className="flex items-center justify-between"><span className="grid h-9 w-9 place-items-center rounded-lg bg-muted"><UploadCloud size={16}/></span>{files[key]&&<StatusPill tone="good">Loaded</StatusPill>}</div>
          <p className="mt-4 text-sm font-extrabold">{label}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">{files[key]?.name || `Choose ${example}`}</p>
          {files[key]&&<p className="mt-2 text-[10px] font-bold text-primary">{files[key].rows} data rows</p>}
        </label>)}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={inspect} disabled={!ready||!!busy}><FileUp size={14}/> {busy==='inspect'?'Inspecting…':'Validate & Clean'}</Button>
        {quality && Object.entries(quality).map(([key,value]:any)=><DownloadButton key={key} label={`Download cleaned ${key}`} text={value.cleaned_csv} filename={`cleaned-${key}.csv`}/>)}
      </div>
    </section>

    <section className="mb-6 rounded-2xl border border-border bg-card p-5">
      <SectionHeading title="2 · Admin configuration" description="Working days and daily academic hours are runtime controls; changing them changes the optimization search space." />
      <div className="grid gap-5 md:grid-cols-[1fr_220px]">
        <div><p className="mb-2 text-xs font-bold">Working days</p><div className="flex flex-wrap gap-2">{DAYS.map(day=><button key={day} onClick={()=>setConfig(c=>({...c,days:c.days.includes(day)?c.days.filter(x=>x!==day):[...c.days,day]}))} className={`rounded-lg border px-3 py-2 text-xs font-bold ${config.days.includes(day)?'border-primary bg-primary/10 text-primary':'border-border text-muted-foreground'}`}>{day}</button>)}</div></div>
        <label><span className="mb-2 block text-xs font-bold">Academic hours / day</span><input type="number" min={1} max={10} value={config.hours} onChange={e=>setConfig(c=>({...c,hours:Number(e.target.value)}))} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"/></label>
      </div>
    </section>

    {analytics?.divisions?.length > 0 && <section className="mb-6 rounded-2xl border border-border bg-card p-5">
      <SectionHeading title="Division-specific settings" description="Override days/week and hours/day for individual divisions. These values are sent directly to the optimizer." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {analytics.divisions.map((d:any)=>{
          const current=config.divisionSettings[d.division] || {days:config.days.length,hours:config.hours};
          return <div key={d.division} className="rounded-xl border border-border p-4">
            <p className="text-sm font-black">{d.division}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{d.student_count} students · {d.weekly_hours} required subject hours</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-[10px] font-bold">Days/week<input type="number" min={1} max={config.days.length} value={current.days} onChange={e=>setConfig(c=>({...c,divisionSettings:{...c.divisionSettings,[d.division]:{...current,days:Number(e.target.value)}}}))} className="mt-1 w-full rounded-lg border border-input bg-background px-2 py-2 text-xs"/></label>
              <label className="text-[10px] font-bold">Hours/day<input type="number" min={1} max={10} value={current.hours} onChange={e=>setConfig(c=>({...c,divisionSettings:{...c.divisionSettings,[d.division]:{...current,hours:Number(e.target.value)}}}))} className="mt-1 w-full rounded-lg border border-input bg-background px-2 py-2 text-xs"/></label>
            </div>
          </div>
        })}
      </div>
    </section>}

    {quality && <section className="mb-6 rounded-2xl border border-border bg-card p-5">
      <SectionHeading title="3 · Data Quality Report" description="Actual values from the uploaded files after conservative cleaning." />
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{Object.entries(quality).map(([key,v]:any)=><div key={key} className="rounded-xl bg-muted/50 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{key}</p><p className="mt-1 text-lg font-black">{v.rows_after}</p><p className="text-[10px] text-muted-foreground">{v.invalid_records} invalid · {v.duplicates} duplicates · {v.outliers_detected} outliers</p></div>)}</div>
    </section>}

    <section className="mb-6 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><SectionHeading title="4 · ML Model Training" description="Synthetic Training Data is generated from candidate assignment features because no historical timetable labels are assumed."/><Button onClick={train} disabled={!ready||!!busy}><BrainCircuit size={14}/> {busy==='train'?'Training…':'Train & Compare Models'}</Button></div>
      {model && <div className="mt-5">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard label="Best model" value={best || '—'} note="Selected by validation F1" icon={BrainCircuit} accent="blue"/>
          <MetricCard label="Test accuracy" value={`${(metric.accuracy*100).toFixed(1)}%`} note="Actual test result" icon={Gauge} accent="teal"/>
          <MetricCard label="Test F1" value={`${(metric.f1*100).toFixed(1)}%`} note="Actual test result" icon={CheckCircle2} accent="teal"/>
          <MetricCard label="ROC-AUC" value={metric.roc_auc==null?'—':metric.roc_auc.toFixed(3)} note="Actual test result" icon={Gauge} accent="amber"/>
          <MetricCard label="Training rows" value={model.rows} note="Synthetic Training Data" icon={Settings2} accent="blue"/>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-left text-xs"><thead className="bg-muted/50"><tr><th className="p-3">Model</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th></tr></thead><tbody>{comparison.map((m:any)=><tr key={m.model} className="border-t border-border"><td className="p-3 font-bold">{m.model}{m.model===best&&<span className="ml-2 text-primary">★ selected</span>}</td><td>{(m.accuracy*100).toFixed(1)}%</td><td>{(m.precision*100).toFixed(1)}%</td><td>{(m.recall*100).toFixed(1)}%</td><td>{(m.f1*100).toFixed(1)}%</td></tr>)}</tbody></table></div>
        <div className="mt-4"><p className="mb-2 text-xs font-bold">Actual feature importance</p><div className="grid gap-2 md:grid-cols-2">{(model.feature_importance||[]).slice(0,10).map((f:any)=><div key={f.feature} className="flex items-center gap-2"><span className="w-44 truncate text-[10px] text-muted-foreground">{f.feature}</span><div className="h-2 flex-1 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{width:`${Math.min(100,f.importance*100)}%`}}/></div><span className="w-12 text-right font-mono text-[10px]">{(f.importance*100).toFixed(1)}%</span></div>)}</div></div>
      </div>}
    </section>

    {result && <section className="mb-6 rounded-2xl border border-border bg-card p-5">
      <SectionHeading title="5 · Optimized timetable result" description="The ML model scores candidate assignments; the MILP optimizer enforces hard constraints."/>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-5">
        <MetricCard label={result.quality_score==null?'Validation':'Quality score'} value={result.quality_score==null?(result.conflicts.length?'Review needed':'Conflict free'):`${Number(result.quality_score).toFixed(1)}/100`} note={result.quality_score==null?'Hard constraints':'Calculated from solution'} icon={Gauge} accent="teal"/>
        <MetricCard label="Sessions" value={result.sessions.length} note="Scheduled across divisions" icon={CheckCircle2} accent="blue"/>
        <MetricCard label="Candidate assignments" value={result.candidate_count??'—'} note={result.engine==='catalog'?'Database catalog scheduler':'After ML scoring'} icon={Settings2} accent="amber"/>
        <MetricCard label="Required tasks" value={result.task_count??result.sessions.length} note="Scheduled subject sessions" icon={Settings2} accent="blue"/>
        <MetricCard label="Hard conflicts" value={result.conflicts.length} note={result.conflicts.length?'Needs review':'All satisfied'} icon={result.conflicts.length?Settings2:CheckCircle2} accent={result.conflicts.length?'red':'teal'}/>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-left text-xs"><thead className="bg-muted/50"><tr><th className="p-3">Day</th><th>Time</th><th>Division</th><th>Subject</th><th>Faculty</th><th>Room</th><th>{result.engine==='catalog'?'Class type':'ML score'}</th></tr></thead><tbody>{result.sessions.map((s:any,i:number)=><tr key={`${s.day}-${s.time}-${i}`} className="border-t border-border"><td className="p-3 font-bold">{s.day}</td><td>{s.time}</td><td>{s.division}</td><td className="font-bold">{s.subject}</td><td>{s.faculty}</td><td>{s.room}</td><td>{s.mlScore==null?s.classType:`${s.mlScore}%`}</td></tr>)}</tbody></table></div>
      {result.conflicts.length>0&&<div className="mt-4 rounded-xl bg-destructive/5 p-4">{result.conflicts.map((c:any,i:number)=><p key={i} className="text-xs text-destructive"><b>{c.title}:</b> {c.detail}</p>)}</div>}
    </section>}

    {analytics && <section className="rounded-2xl border border-border bg-card p-5">
      <SectionHeading title="6 · Analytics" description="Actual dataset distributions used by the ML pipeline."/>
      <div className="grid gap-5 lg:grid-cols-2"><div><p className="mb-3 text-xs font-bold">Division / student distribution</p>{analytics.divisions.map((d:any)=><div key={d.division} className="mb-3"><div className="flex justify-between text-[10px]"><span>{d.division}</span><span>{d.student_count} students · {d.weekly_hours} h/week</span></div><div className="mt-1 h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{width:`${Math.min(100,d.student_count)}%`}}/></div></div>)}</div><div><p className="mb-3 text-xs font-bold">Classroom capacity</p>{Object.entries(analytics.room_capacity).map(([room,cap]:any)=><div key={room} className="mb-3 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs"><span>{room}</span><span className="font-mono">{cap} seats</span></div>)}</div></div>
    </section>}
  </div>;
}
