import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireRole } from "../lib/auth-middleware";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadMlPayload, runMlEngine, saveMlPayload, type MlPayload, ML_ROOT, ML_META } from "../lib/ml-engine";
import { runGeneration } from "./academic";

const router: IRouter = Router();
router.use(requireRole("admin"));

const Payload = z.object({
  teachers_csv: z.string().min(1),
  students_csv: z.string().min(1),
  classrooms_csv: z.string().min(1),
  config: z.object({
    working_days: z.array(z.string()).optional(),
    hours_per_day: z.number().int().min(1).max(10).optional(),
    division_settings: z.record(z.string(), z.object({
      days_per_week: z.number().int().min(1).max(6).optional(),
      hours_per_day: z.number().int().min(1).max(10).optional(),
    })).optional(),
  }).optional(),
});

router.get("/ml/status", async (_req, res) => {
  const payload = loadMlPayload();
  let model: any = null;
  if (existsSync(ML_META)) {
    try { model = JSON.parse(readFileSync(ML_META, "utf8")); } catch { model = null; }
  }
  res.json({ uploaded: Boolean(payload), trained: Boolean(model), model });
});

router.post("/ml/inspect", async (req, res) => {
  const parsed = Payload.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Upload all three CSV datasets before inspection." });
    return;
  }
  const payload = parsed.data as MlPayload;
  saveMlPayload(payload);
  const result = await runMlEngine("inspect", payload);
  res.json(result);
});

router.post("/ml/train", async (req, res) => {
  const parsed = Payload.safeParse(req.body);
  const payload = parsed.success ? parsed.data as MlPayload : loadMlPayload();
  if (!payload) {
    res.status(400).json({ error: "Upload teachers, students/divisions and classrooms CSV files first." });
    return;
  }
  if (parsed.success) saveMlPayload(payload);
  const result = await runMlEngine("train", payload);
  res.json(result);
});

router.post("/ml/generate", async (req, res) => {
  const parsed = Payload.safeParse(req.body);
  const payload = parsed.success ? parsed.data as MlPayload : loadMlPayload();
  if (!payload) {
    res.status(400).json({ error: "Upload all three CSV datasets first." });
    return;
  }
  if (parsed.success) saveMlPayload(payload);
  // Keep upload validation and analytics, but schedule using the database's
  // complete subject catalog, student choices, and configured lab batches.
  const inspected = await runMlEngine("inspect", payload);
  const schedule = await runGeneration();
  let model: any = null;
  if (existsSync(ML_META)) {
    try { model = JSON.parse(readFileSync(ML_META, "utf8")); } catch { model = null; }
  }
  res.json({
    ...schedule,
    engine: "catalog",
    data_quality: inspected.data_quality,
    analytics: inspected.analytics,
    model,
    task_count: schedule.sessions.length,
  });
});



router.get("/ml/sample", async (_req, res) => {
  const dir = path.join(ML_ROOT, "sample_data");
  const files = ["teachers.csv", "students.csv", "classrooms.csv"];
  if (!files.every((name) => existsSync(path.join(dir, name)))) {
    res.status(404).json({ error: "Sample datasets are not available." });
    return;
  }
  res.json({
    teachers_csv: readFileSync(path.join(dir, "teachers.csv"), "utf8"),
    students_csv: readFileSync(path.join(dir, "students.csv"), "utf8"),
    classrooms_csv: readFileSync(path.join(dir, "classrooms.csv"), "utf8"),
    config: { working_days: ["Monday","Tuesday","Wednesday","Thursday","Friday"], hours_per_day: 5 },
  });
});

router.get("/ml/templates/:type", async (req, res) => {
  const templates: Record<string, string> = {
    teachers: "teacher_id,teacher_name,department,subject,max_hours_per_week,preferred_days,preferred_time_slots,unavailable_days,unavailable_slots\nT001,Example Teacher,CSE,Data Structures,12,Monday|Tuesday,08:00-12:00,,14:00-15:00\n",
    students: "student_id,student_name,department,year,semester,division,roll_number,subjects,academic_hours_required,student_count\nD001,CSE-A Students,CSE,3,5,CSE-A,1,\"Data Structures:3;Database Systems:3;Machine Learning:3;Computer Networks:3\",12,40\n",
    classrooms: "classroom_id,room_number,building,floor,room_type,capacity,department,available_days,available_slots,has_projector,has_computer,has_lab,lab_type\nR001,101,Main,1,lecture,50,CSE,Monday|Tuesday|Wednesday|Thursday|Friday,08:00-12:00|14:00-18:00,1,1,0,\n",
  };
  const value = templates[req.params.type];
  if (!value) { res.status(404).json({ error: "Unknown template." }); return; }
  res.type("text/csv").send(value);
});

export default router;
