import json
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"ml_engine"))
import engine

SAMPLE=ROOT/"ml_engine"/"sample_data"

def load():
    payload={
      "teachers_csv":(SAMPLE/"teachers.csv").read_text(),
      "students_csv":(SAMPLE/"students.csv").read_text(),
      "classrooms_csv":(SAMPLE/"classrooms.csv").read_text(),
      "config":{"working_days":["Monday","Tuesday","Wednesday","Thursday","Friday"],"hours_per_day":5}
    }
    return engine.parse_payload(payload)

class TimetableMLTests(unittest.TestCase):
    def test_csv_validation_and_cleaning(self):
        teachers,students,rooms,config,reports=load()
        self.assertEqual(len(teachers),6)
        self.assertEqual(len(students),2)
        self.assertEqual(len(rooms),5)
        self.assertIn("cleaned_csv",reports["teachers"])

    def test_missing_column_rejected(self):
        with self.assertRaises(ValueError):
            engine.read_clean_csv("teacher_name\nA\n",engine.TEACHER_REQUIRED,"Teacher")

    def test_model_training_and_metrics(self):
        teachers,students,rooms,config,_=load()
        meta=engine.train_models(teachers,students,rooms,config)
        self.assertIn(meta["best_model"],{"Decision Tree","Random Forest","Gradient Boosting"})
        self.assertEqual(meta["train_rows"]+meta["validation_rows"]+meta["test_rows"],meta["rows"])
        self.assertIn("f1",meta["test_metrics"])
        self.assertTrue(meta["feature_importance"])

    def test_generation_has_no_hard_conflicts(self):
        teachers,students,rooms,config,_=load()
        result=engine.generate(teachers,students,rooms,config)
        self.assertGreater(len(result["sessions"]),0)
        self.assertEqual(result["conflicts"],[])
        self.assertGreater(result["quality_score"],0)

    def test_division_specific_days(self):
        teachers,students,rooms,config,_=load()
        config["division_settings"]={"CSE-A":{"days_per_week":3,"hours_per_day":5}}
        result=engine.generate(teachers,students,rooms,config)
        days={s["day"] for s in result["sessions"] if s["division"]=="CSE-A"}
        self.assertLessEqual(len(days),3)

    def test_feature_engineering_candidate_columns(self):
        teachers,students,rooms,config,_=load()
        model=engine.joblib.load(engine.MODEL_PATH)
        tasks,cands=engine.candidate_generation(teachers,students,rooms,config,model)
        self.assertTrue(tasks)
        self.assertTrue(cands)
        self.assertTrue(all(set(engine.FEATURES).issubset(c["features"]) for c in cands[:10]))

    def test_model_prediction_scores(self):
        teachers,students,rooms,config,_=load()
        model=engine.joblib.load(engine.MODEL_PATH)
        tasks,cands=engine.candidate_generation(teachers,students,rooms,config,model)
        self.assertTrue(all(0 <= c["ml_score"] <= 1 for c in cands[:50]))

    def test_teacher_conflict_detection(self):
        chosen=[{"teacher_id":"T1","room_number":"R1","division":"D1","day":"Monday","start_index":0,"duration":1,"ml_score":.8,"features":{"teacher_preference_match":1,"capacity_difference":10,"student_count":10}},
                {"teacher_id":"T1","room_number":"R2","division":"D2","day":"Monday","start_index":0,"duration":1,"ml_score":.8,"features":{"teacher_preference_match":1,"capacity_difference":10,"student_count":10}}]
        conflicts=engine.validate_schedule(chosen,{"working_days":["Monday"],"hours_per_day":5},[])
        self.assertTrue(any("Teacher conflict"==c["title"] for c in conflicts))

    def test_classroom_conflict_detection(self):
        chosen=[{"teacher_id":"T1","room_number":"R1","division":"D1","day":"Monday","start_index":0,"duration":1,"ml_score":.8,"features":{"teacher_preference_match":1,"capacity_difference":10,"student_count":10}},
                {"teacher_id":"T2","room_number":"R1","division":"D2","day":"Monday","start_index":0,"duration":1,"ml_score":.8,"features":{"teacher_preference_match":1,"capacity_difference":10,"student_count":10}}]
        conflicts=engine.validate_schedule(chosen,{"working_days":["Monday"],"hours_per_day":5},[])
        self.assertTrue(any("Room conflict"==c["title"] for c in conflicts))

    def test_division_conflict_detection(self):
        chosen=[{"teacher_id":"T1","room_number":"R1","division":"D1","day":"Monday","start_index":0,"duration":1,"ml_score":.8,"features":{"teacher_preference_match":1,"capacity_difference":10,"student_count":10}},
                {"teacher_id":"T2","room_number":"R2","division":"D1","day":"Monday","start_index":0,"duration":1,"ml_score":.8,"features":{"teacher_preference_match":1,"capacity_difference":10,"student_count":10}}]
        conflicts=engine.validate_schedule(chosen,{"working_days":["Monday"],"hours_per_day":5},[])
        self.assertTrue(any("Division conflict"==c["title"] for c in conflicts))

    def test_weekly_hours_validation(self):
        chosen=[]
        divs=[{"division":"D1","student_count":20,"subjects":[{"name":"A","hours":3,"type":"Theory"}]}]
        conflicts=engine.validate_schedule(chosen,{"working_days":["Monday"],"hours_per_day":5},divs)
        self.assertTrue(any(c["category"]=="Weekly hours" for c in conflicts))

    def test_quality_score_is_bounded(self):
        teachers,students,rooms,config,_=load()
        result=engine.generate(teachers,students,rooms,config)
        self.assertGreaterEqual(result["quality_score"],0)
        self.assertLessEqual(result["quality_score"],100)

    def test_capacity_filtering(self):
        teachers,students,rooms,config,_=load()
        rooms=rooms.copy()
        rooms["capacity"]=10
        with self.assertRaises(ValueError):
            engine.generate(teachers,students,rooms,config)

if __name__=="__main__":
    unittest.main()
