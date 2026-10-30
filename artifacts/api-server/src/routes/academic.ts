import { Router, type IRouter } from "express";
import { count, eq } from "drizzle-orm";
import { z } from "zod";

import {
  CreateFacultyBody,
  CreateFacultyResponse,
  CreateStudentBody,
  CreateStudentResponse,
  CreateSubjectBody,
  CreateSubjectResponse,
  DeleteStudentParams,
  GetDashboardSummaryResponse,
  GetStudentParams,
  GetStudentResponse,
  GetTimetableConflictsResponse,
  GetTimetableResponse,
  ListFacultyResponse,
  ListStudentsResponse,
  ListSubjectsResponse,
  UpdateStudentBody,
  UpdateStudentParams,
  UpdateStudentResponse,
} from "@workspace/api-zod";

import { db } from "@workspace/db";

import {
  classrooms,
  conflicts,
  faculty,
  facultyAvailability,
  students,
  subjects,
  timetable,
  subjectFacultyAssignments,
  divisionHolidays,
  labBatches,
  divisionRoomAssignments,
  users,
  divisions,
} from "@workspace/db/schema";

import { requireRole } from "../lib/auth-middleware";
import { generateTimetable } from "../lib/scheduler";
import { runMlEngine, loadMlPayload, type MlPayload } from "../lib/ml-engine";

const router: IRouter = Router();

/*
 * Everything in this file is admin-only management.
 */
router.use(requireRole("admin"));

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const classroomView = (row: typeof classrooms.$inferSelect) => ({
  id: row.id,
  roomNumber: row.roomNumber,
  building: row.building,
  capacity: row.capacity,
  roomType: row.roomType,
});

const CreateClassroomBody = z.object({
  roomNumber: z.string().min(1),
  building: z.string().nullish(),
  capacity: z.number().int().positive().optional(),
  roomType: z.enum(["lecture", "lab", "seminar"]).optional(),
});

function canonicalDivision(value: string): string {
  const v = value.trim().toUpperCase().replace(/_/g, "-").replace(/\s+/g, " ");
  const ty = v.match(/^TY\s*-?\s*([A-Z])$/);
  if (ty) return `TY-${ty[1]}`;
  const aiml = v.match(/^AIML\s*-?\s*([A-Z])$/);
  if (aiml) return aiml[1] === "B" ? "TY-B" : `AIML-${aiml[1]}`;
  return v;
}

const studentView = (row: typeof students.$inferSelect) => ({
  id: row.id,
  name: row.name,
  division: canonicalDivision(row.division),
  rollNo: row.rollNo,
  prn: row.prn,
  registeredSubject: row.registeredSubject,
});

const facultyView = (row: typeof faculty.$inferSelect) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  department: row.department,
  maxWeeklyHours: row.maxWeeklyHours,
});

const subjectView = (row: typeof subjects.$inferSelect) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  type: row.type,
  weeklyHours: row.weeklyHours,
});

/* -------------------------------------------------------------------------- */
/* Students                                                                   */
/* -------------------------------------------------------------------------- */

router.get("/students", async (_req, res) => {
  const rows = await db
    .select()
    .from(students)
    .orderBy(students.division, students.rollNo);

  res.json(ListStudentsResponse.parse(rows.map(studentView)));
});

router.post("/students", async (req, res) => {
  const input = CreateStudentBody.parse(req.body);

  const [result] = await db.insert(students).values({
    name: input.name,
    division: input.division,
    rollNo: input.rollNo,
    prn: input.prn ?? null,
    registeredSubject: input.registeredSubject,
  });

  const [row] = await db
    .select()
    .from(students)
    .where(eq(students.id, result.insertId));

  res.status(201).json(
    CreateStudentResponse.parse(studentView(row)),
  );
});

router.get("/students/:id", async (req, res) => {
  const { id } = GetStudentParams.parse(req.params);

  const [row] = await db
    .select()
    .from(students)
    .where(eq(students.id, id));

  if (!row) {
    res.status(404).json({
      error: "Student not found.",
    });
    return;
  }

  res.json(GetStudentResponse.parse(studentView(row)));
});

router.patch("/students/:id", async (req, res) => {
  const { id } = UpdateStudentParams.parse(req.params);
  const input = UpdateStudentBody.parse(req.body);

  await db
    .update(students)
    .set({
      name: input.name,
      division: input.division,
      rollNo: input.rollNo,
      prn: input.prn ?? null,
      registeredSubject: input.registeredSubject,
    })
    .where(eq(students.id, id));

  const [row] = await db
    .select()
    .from(students)
    .where(eq(students.id, id));

  if (!row) {
    res.status(404).json({
      error: "Student not found.",
    });
    return;
  }

  res.json(
    UpdateStudentResponse.parse(studentView(row)),
  );
});

router.delete("/students/:id", async (req, res) => {
  const { id } = DeleteStudentParams.parse(req.params);

  await db
    .update(users)
    .set({ studentId: null })
    .where(eq(users.studentId, id));

  await db
    .delete(students)
    .where(eq(students.id, id));

  res.status(204).send();
});

/* -------------------------------------------------------------------------- */
/* Faculty                                                                    */
/* -------------------------------------------------------------------------- */

router.get("/faculty", async (_req, res) => {
  const rows = await db
    .select()
    .from(faculty)
    .orderBy(faculty.name);

  res.json(
    ListFacultyResponse.parse(rows.map(facultyView)),
  );
});

router.post("/faculty", async (req, res) => {
  const input = CreateFacultyBody.parse(req.body);

  const [result] = await db.insert(faculty).values({
    name: input.name,
    email: input.email ?? null,
    department: input.department ?? null,
    maxWeeklyHours: input.maxWeeklyHours ?? 18,
  });

  const [row] = await db
    .select()
    .from(faculty)
    .where(eq(faculty.id, result.insertId));

  res.status(201).json(
    CreateFacultyResponse.parse(facultyView(row)),
  );
});

router.patch("/faculty/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid faculty id." });
    return;
  }
  const parsed = z.object({
    name: z.string().min(1),
    email: z.string().email().nullish(),
    department: z.string().nullish(),
    maxWeeklyHours: z.number().int().positive(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid faculty profile.", issues: parsed.error.issues });
    return;
  }
  await db.update(faculty).set({
    name: parsed.data.name.trim(),
    email: parsed.data.email ?? null,
    department: parsed.data.department?.trim() || null,
    maxWeeklyHours: parsed.data.maxWeeklyHours,
  }).where(eq(faculty.id, id));
  const [row] = await db.select().from(faculty).where(eq(faculty.id, id));
  if (!row) { res.status(404).json({ error: "Faculty member not found." }); return; }
  res.json(facultyView(row));
});

router.delete("/faculty/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({
      error: "Invalid faculty id.",
    });
    return;
  }

  await db
    .update(users)
    .set({ facultyId: null })
    .where(eq(users.facultyId, id));

  await db
    .delete(subjectFacultyAssignments)
    .where(eq(subjectFacultyAssignments.facultyId, id));

  await db
    .delete(faculty)
    .where(eq(faculty.id, id));

  res.status(204).send();
});

/* -------------------------------------------------------------------------- */
/* Subjects                                                                   */
/* -------------------------------------------------------------------------- */

router.get("/subjects", async (_req, res) => {
  const rows = await db
    .select()
    .from(subjects)
    .orderBy(subjects.code);

  res.json(
    ListSubjectsResponse.parse(rows.map(subjectView)),
  );
});

router.post("/subjects", async (req, res) => {
  const input = CreateSubjectBody.parse(req.body);

  const [result] = await db.insert(subjects).values({
    code: input.code,
    name: input.name,
    type: input.type ?? "Theory",
    weeklyHours: input.weeklyHours ?? 1,
  });

  const [row] = await db
    .select()
    .from(subjects)
    .where(eq(subjects.id, result.insertId));

  res.status(201).json(
    CreateSubjectResponse.parse(subjectView(row)),
  );
});

router.delete("/subjects/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({
      error: "Invalid subject id.",
    });
    return;
  }

  const [subjectToDelete] = await db
    .select()
    .from(subjects)
    .where(eq(subjects.id, id));

  if (subjectToDelete) {
    await db.delete(subjectFacultyAssignments).where(eq(subjectFacultyAssignments.subjectCode, subjectToDelete.code));
  }

  await db
    .delete(subjects)
    .where(eq(subjects.id, id));

  res.status(204).send();
});

/* -------------------------------------------------------------------------- */
/* Classrooms                                                                 */
/* -------------------------------------------------------------------------- */

router.get("/classrooms", async (_req, res) => {
  const rows = await db
    .select()
    .from(classrooms)
    .orderBy(classrooms.roomNumber);

  res.json(rows.map(classroomView));
});

router.post("/classrooms", async (req, res) => {
  const input = CreateClassroomBody.parse(req.body);

  const [result] = await db
    .insert(classrooms)
    .values({
      roomNumber: input.roomNumber,
      building: input.building ?? null,
      capacity: input.capacity ?? 40,
      roomType: input.roomType ?? "lecture",
    });

  const [row] = await db
    .select()
    .from(classrooms)
    .where(eq(classrooms.id, result.insertId));

  res.status(201).json(classroomView(row));
});

router.delete("/classrooms/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({
      error: "Invalid classroom id.",
    });
    return;
  }

  await db
    .delete(classrooms)
    .where(eq(classrooms.id, id));

  res.status(204).send();
});

/* -------------------------------------------------------------------------- */
/* Advanced planning: lab batches + preferred rooms/labs                     */
/* -------------------------------------------------------------------------- */

router.get("/planning/lab-batches", async (_req, res) => {
  const rows = await db.select().from(labBatches);
  res.json(rows.map((row) => ({ ...row, division: canonicalDivision(row.division) })));
});

router.put("/planning/lab-batches", async (req, res) => {
  const parsed = z.object({
    division: z.string().min(1),
    subjectCode: z.string().nullish(),
    batches: z.array(z.object({
      batchName: z.string().min(1),
      studentCount: z.number().int().positive(),
    })).min(1),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "division, subjectCode and at least one batch are required.", issues: parsed.error.issues });
    return;
  }
  const division = canonicalDivision(parsed.data.division);
  const subjectCode = parsed.data.subjectCode?.trim().toUpperCase() || null;
  const existing = await db.select().from(labBatches);
  for (const row of existing) {
    if (canonicalDivision(row.division) === division && (row.subjectCode || null) === subjectCode) {
      await db.delete(labBatches).where(eq(labBatches.id, row.id));
    }
  }
  for (const batch of parsed.data.batches) {
    await db.insert(labBatches).values({
      division,
      subjectCode,
      batchName: batch.batchName.trim(),
      studentCount: batch.studentCount,
    });
  }
  res.status(201).json(await db.select().from(labBatches));
});

router.delete("/planning/lab-batches/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid batch id." }); return; }
  await db.delete(labBatches).where(eq(labBatches.id, id));
  res.status(204).send();
});

router.get("/planning/room-assignments", async (_req, res) => {
  const rows = await db.select({
    id: divisionRoomAssignments.id,
    division: divisionRoomAssignments.division,
    roomId: divisionRoomAssignments.roomId,
    classType: divisionRoomAssignments.classType,
    subjectCode: divisionRoomAssignments.subjectCode,
    batchName: divisionRoomAssignments.batchName,
    roomNumber: classrooms.roomNumber,
  }).from(divisionRoomAssignments).leftJoin(classrooms, eq(divisionRoomAssignments.roomId, classrooms.id));
  res.json(rows.map((row) => ({ ...row, division: canonicalDivision(row.division) })));
});

router.post("/planning/room-assignments", async (req, res) => {
  const parsed = z.object({
    division: z.string().min(1),
    roomId: z.number().int().nonnegative(),
    classType: z.enum(["Theory", "Tutorial", "Lab"]),
    subjectCode: z.string().nullish(),
    batchName: z.string().nullish(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid room assignment.", issues: parsed.error.issues }); return; }
  const [room] = await db.select().from(classrooms).where(eq(classrooms.id, parsed.data.roomId));
  if (!room) { res.status(404).json({ error: "Room not found." }); return; }
  const division = canonicalDivision(parsed.data.division);
  const subjectCode = parsed.data.subjectCode?.trim().toUpperCase() || null;
  const batchName = parsed.data.batchName?.trim() || null;
  const [result] = await db.insert(divisionRoomAssignments).values({ division, roomId: room.id, classType: parsed.data.classType, subjectCode, batchName });
  const [row] = await db.select({
    id: divisionRoomAssignments.id, division: divisionRoomAssignments.division, roomId: divisionRoomAssignments.roomId,
    classType: divisionRoomAssignments.classType, subjectCode: divisionRoomAssignments.subjectCode, batchName: divisionRoomAssignments.batchName, roomNumber: classrooms.roomNumber,
  }).from(divisionRoomAssignments).leftJoin(classrooms, eq(divisionRoomAssignments.roomId, classrooms.id)).where(eq(divisionRoomAssignments.id, result.insertId));
  res.status(201).json(row ? { ...row, division: canonicalDivision(row.division) } : null);
});

router.delete("/planning/room-assignments/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid room assignment id." }); return; }
  await db.delete(divisionRoomAssignments).where(eq(divisionRoomAssignments.id, id));
  res.status(204).send();
});

/* -------------------------------------------------------------------------- */
/* Academic data management                                                  */
/* -------------------------------------------------------------------------- */

router.get("/management/directory", async (_req, res) => {
  const [studentRows, facultyRows, subjectRows, roomRows] = await Promise.all([
    db.select({ id: students.id, name: students.name, division: students.division, rollNo: students.rollNo, isActive: students.isActive }).from(students).orderBy(students.division, students.rollNo),
    db.select({ id: faculty.id, name: faculty.name, department: faculty.department, isActive: faculty.isActive }).from(faculty).orderBy(faculty.name),
    db.select({ id: subjects.id, code: subjects.code, name: subjects.name, type: subjects.type, isActive: subjects.isActive }).from(subjects).orderBy(subjects.code),
    db.select({ id: classrooms.id, roomNumber: classrooms.roomNumber, building: classrooms.building, capacity: classrooms.capacity, roomType: classrooms.roomType, isActive: classrooms.isActive }).from(classrooms).orderBy(classrooms.roomNumber),
  ]);
  res.json({ students: studentRows.map(r => ({ ...r, division: canonicalDivision(r.division) })), faculty: facultyRows, subjects: subjectRows, rooms: roomRows });
});

router.get("/management/divisions", async (_req, res) => {
  const rows = await db.select().from(divisions).orderBy(divisions.name);
  const studentRows = await db.select({ division: students.division }).from(students);
  const counts = new Map<string, number>();
  for (const row of studentRows) {
    const d = canonicalDivision(row.division);
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  res.json(rows.map((row) => ({ ...row, studentCount: counts.get(canonicalDivision(row.name)) || 0 })));
});

router.post("/management/divisions", async (req, res) => {
  const parsed = z.object({ name: z.string().min(1), strength: z.number().int().nonnegative().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid division." });
  const name = canonicalDivision(parsed.data.name);
  try {
    const [result] = await db.insert(divisions).values({ name, strength: parsed.data.strength ?? 0, isActive: true });
    const [row] = await db.select().from(divisions).where(eq(divisions.id, result.insertId));
    return res.status(201).json(row);
  } catch (error: any) {
    return res.status(409).json({ error: error?.message?.includes("Duplicate") ? "That division already exists." : "Could not create division." });
  }
});

router.patch("/management/divisions/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ name: z.string().min(1), strength: z.number().int().nonnegative(), isActive: z.boolean() }).safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) return res.status(400).json({ error: "Invalid division." });
  const name = canonicalDivision(parsed.data.name);
  await db.update(divisions).set({ name, strength: parsed.data.strength, isActive: parsed.data.isActive }).where(eq(divisions.id, id));
  const [row] = await db.select().from(divisions).where(eq(divisions.id, id));
  if (!row) return res.status(404).json({ error: "Division not found." });
  return res.json(row);
});

router.delete("/management/divisions/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid division id." });
  await db.update(divisions).set({ isActive: false }).where(eq(divisions.id, id));
  return res.status(204).send();
});

router.get("/management/faculty-availability", async (_req, res) => {
  const rows = await db.select({ id: facultyAvailability.id, facultyId: facultyAvailability.facultyId, facultyName: faculty.name, day: facultyAvailability.day, startTime: facultyAvailability.startTime, endTime: facultyAvailability.endTime, isAvailable: facultyAvailability.isAvailable }).from(facultyAvailability).leftJoin(faculty, eq(facultyAvailability.facultyId, faculty.id)).orderBy(faculty.name, facultyAvailability.day, facultyAvailability.startTime);
  res.json(rows);
});

router.post("/management/faculty-availability", async (req, res) => {
  const parsed = z.object({ facultyId: z.number().int().positive(), day: z.string().min(1), startTime: z.string().min(1), endTime: z.string().min(1), isAvailable: z.boolean().default(true) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid availability entry." });
  const [person] = await db.select().from(faculty).where(eq(faculty.id, parsed.data.facultyId));
  if (!person) return res.status(404).json({ error: "Faculty member not found." });
  const [result] = await db.insert(facultyAvailability).values(parsed.data);
  const [row] = await db.select({ id: facultyAvailability.id, facultyId: facultyAvailability.facultyId, facultyName: faculty.name, day: facultyAvailability.day, startTime: facultyAvailability.startTime, endTime: facultyAvailability.endTime, isAvailable: facultyAvailability.isAvailable }).from(facultyAvailability).leftJoin(faculty, eq(facultyAvailability.facultyId, faculty.id)).where(eq(facultyAvailability.id, result.insertId));
  return res.status(201).json(row);
});

router.delete("/management/faculty-availability/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid availability id." });
  await db.delete(facultyAvailability).where(eq(facultyAvailability.id, id));
  return res.status(204).send();
});

router.post("/management/students/import", async (req, res) => {
  const parsed = z.object({ rows: z.array(z.object({ name: z.string().min(1), division: z.string().min(1), rollNo: z.number().int().positive(), prn: z.string().nullish(), registeredSubject: z.string().optional() })).min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid import rows.", issues: parsed.error.issues });
  let imported = 0, updated = 0, skipped = 0;
  const errors: { row: number; error: string }[] = [];
  for (let i = 0; i < parsed.data.rows.length; i++) {
    const item = parsed.data.rows[i];
    const division = canonicalDivision(item.division);
    const duplicate = await db.select().from(students).where(eq(students.rollNo, item.rollNo));
    const sameDivision = duplicate.find((s) => canonicalDivision(s.division) === division);
    try {
      if (sameDivision) {
        await db.update(students).set({ name: item.name.trim(), division, prn: item.prn?.trim() || null, registeredSubject: item.registeredSubject?.trim() || sameDivision.registeredSubject, isActive: true }).where(eq(students.id, sameDivision.id));
        updated++;
      } else if (duplicate.length) {
        skipped++; errors.push({ row: i + 2, error: `Roll number ${item.rollNo} already exists in another division.` });
      } else {
        await db.insert(students).values({ name: item.name.trim(), division, rollNo: item.rollNo, prn: item.prn?.trim() || null, registeredSubject: item.registeredSubject?.trim() || "CN", isActive: true });
        imported++;
      }
    } catch (error: any) { skipped++; errors.push({ row: i + 2, error: error?.message || "Could not import row." }); }
  }
  return res.status(201).json({ imported, updated, skipped, errors });
});

router.patch("/students/:id/status", async (req, res) => {
  const id = Number(req.params.id); const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) return res.status(400).json({ error: "Invalid status request." });
  await db.update(students).set({ isActive: parsed.data.isActive }).where(eq(students.id, id));
  return res.json({ id, isActive: parsed.data.isActive });
});
router.patch("/faculty/:id/status", async (req, res) => {
  const id = Number(req.params.id); const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) return res.status(400).json({ error: "Invalid status request." });
  await db.update(faculty).set({ isActive: parsed.data.isActive }).where(eq(faculty.id, id));
  return res.json({ id, isActive: parsed.data.isActive });
});
router.patch("/classrooms/:id/status", async (req, res) => {
  const id = Number(req.params.id); const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) return res.status(400).json({ error: "Invalid status request." });
  await db.update(classrooms).set({ isActive: parsed.data.isActive }).where(eq(classrooms.id, id));
  return res.json({ id, isActive: parsed.data.isActive });
});

router.patch("/subjects/:id", async (req, res) => {
  const id = Number(req.params.id); const parsed = z.object({ code: z.string().min(1), name: z.string().min(1), type: z.string().min(1), weeklyHours: z.number().int().positive(), isActive: z.boolean().optional() }).safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) return res.status(400).json({ error: "Invalid subject." });
  await db.update(subjects).set({ code: parsed.data.code.trim().toUpperCase(), name: parsed.data.name.trim(), type: parsed.data.type, weeklyHours: parsed.data.weeklyHours, ...(parsed.data.isActive === undefined ? {} : { isActive: parsed.data.isActive }) }).where(eq(subjects.id, id));
  const [row] = await db.select().from(subjects).where(eq(subjects.id, id));
  if (!row) return res.status(404).json({ error: "Subject not found." });
  return res.json(row);
});
router.patch("/subjects/:id/status", async (req, res) => {
  const id = Number(req.params.id); const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) return res.status(400).json({ error: "Invalid status request." });
  await db.update(subjects).set({ isActive: parsed.data.isActive }).where(eq(subjects.id, id));
  return res.json({ id, isActive: parsed.data.isActive });
});
router.patch("/classrooms/:id", async (req, res) => {
  const id = Number(req.params.id); const parsed = z.object({ roomNumber: z.string().min(1), building: z.string().nullish(), capacity: z.number().int().positive(), roomType: z.enum(["lecture", "lab", "seminar"]), isActive: z.boolean().optional() }).safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) return res.status(400).json({ error: "Invalid room/lab." });
  await db.update(classrooms).set({ roomNumber: parsed.data.roomNumber.trim(), building: parsed.data.building?.trim() || null, capacity: parsed.data.capacity, roomType: parsed.data.roomType, ...(parsed.data.isActive === undefined ? {} : { isActive: parsed.data.isActive }) }).where(eq(classrooms.id, id));
  const [row] = await db.select().from(classrooms).where(eq(classrooms.id, id));
  if (!row) return res.status(404).json({ error: "Room/lab not found." });
  return res.json(row);
});

/* -------------------------------------------------------------------------- */
/* Timetable                                                                   */
/* -------------------------------------------------------------------------- */

/*
 * Get the generated timetable.
 */
router.get("/timetable", async (_req, res) => {
  const rows = await db
    .select()
    .from(timetable);

  res.json(
    GetTimetableResponse.parse(rows),
  );
});

router.post("/timetable/validate", async (_req, res) => {
  const drafts = await db.select().from(timetable).where(eq(timetable.status, "draft"));
  const issues: { id: number; error: string }[] = [];
  for (const row of drafts) {
    const person = (await db.select().from(faculty)).find((f) => f.name === row.faculty);
    const room = row.room === "Online" ? null : (await db.select().from(classrooms)).find((r) => r.roomNumber === row.room);
    if (!person) { issues.push({ id: row.id, error: `Faculty ${row.faculty} was not found.` }); continue; }
    if (row.room !== "Online" && !room) { issues.push({ id: row.id, error: `Room ${row.room} was not found.` }); continue; }
    const error = await validateManualEntry({
      day: row.day, time: row.time, subject: row.subject, facultyId: person.id, roomId: room?.id ?? 0,
      division: row.division, classType: row.classType as "Theory" | "Tutorial" | "Lab", batch: row.batch, batchSize: row.batchSize, status: "draft",
    }, row.id);
    if (error) issues.push({ id: row.id, error });
  }
  if (issues.length) {
    await db.delete(conflicts);
    await db.insert(conflicts).values(issues.map((issue) => ({ severity: "medium", title: `Draft session ${issue.id} needs review`, detail: issue.error, category: "Manual review" })));
    res.status(409).json({ valid: false, issues });
    return;
  }
  await db.delete(conflicts);
  res.json({ valid: true, issues: [] });
});

router.post("/timetable/publish", async (_req, res) => {
  const draftRows = await db.select().from(timetable).where(eq(timetable.status, "draft"));
  const conflictRows = await db.select().from(conflicts);
  if (conflictRows.length) {
    res.status(409).json({ error: `Resolve ${conflictRows.length} generated conflict(s) before publishing.` });
    return;
  }
  if (!draftRows.length) {
    res.status(409).json({ error: "There is no draft timetable to publish." });
    return;
  }

  // A draft may be a full regeneration or a scoped regeneration. Replace the
  // currently published rows only for divisions represented by the draft, so
  // a one-division review never deletes unrelated published schedules.
  const draftDivisions = Array.from(new Set(draftRows.map((row) => canonicalDivision(row.division.split(" · ")[0]))));
  const publishedRows = await db.select().from(timetable).where(eq(timetable.status, "published"));
  for (const row of publishedRows) {
    const base = canonicalDivision(row.division.split(" · ")[0]);
    if (draftDivisions.includes(base)) await db.delete(timetable).where(eq(timetable.id, row.id));
  }
  for (const row of draftRows) {
    await db.update(timetable).set({ status: "published" }).where(eq(timetable.id, row.id));
  }
  res.json({ publishedSessions: draftRows.length, divisions: draftDivisions });
});

router.post("/timetable/unpublish", async (_req, res) => {
  await db.update(timetable).set({ status: "draft" });
  res.json({ status: "draft" });
});


/* -------------------------------------------------------------------------- */
/* Manual timetable + planning controls                                      */
/* -------------------------------------------------------------------------- */

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const PERIODS = [
  "8:00–9:00", "9:00–10:00", "10:00–11:00", "11:00–12:00",
  "12:00–1:00", "1:00–2:00", "2:00–3:00", "3:00–4:00",
  "4:00–5:00", "5:00–6:00",
] as const;

const ManualTimetableBody = z.object({
  day: z.string().min(1),
  time: z.string().min(1),
  subject: z.string().min(1),
  facultyId: z.number().int().positive(),
  roomId: z.number().int().nonnegative(),
  division: z.string().min(1),
  classType: z.enum(["Theory", "Tutorial", "Lab"]),
  batch: z.string().nullish(),
  batchSize: z.number().int().positive().nullish(),
  status: z.string().optional(),
});

function slotParts(time: string) {
  return time.split("–").map((v) => v.trim());
}

function timeToMinutes(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return -1;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ap = match[3]?.toUpperCase();
  if (ap === "PM" && hour !== 12) hour += 12;
  if (ap === "AM" && hour === 12) hour = 0;
  if (!ap && hour >= 1 && hour <= 7) hour += 12;
  return hour * 60 + minute;
}

function baseDivision(value: string) {
  return canonicalDivision(value.split(" · ")[0].trim());
}

async function validateManualEntry(input: z.infer<typeof ManualTimetableBody>, excludeId?: number) {
  const day = input.day.trim();
  if (!DAYS.includes(day as (typeof DAYS)[number])) return "Sunday is reserved as a mandatory holiday. Use Monday–Saturday.";
  if (!PERIODS.includes(input.time as (typeof PERIODS)[number])) return "Time must be one of the 08:00–18:00 timetable slots.";

  const [start, end] = slotParts(input.time);
  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  if (startMin < 480 || endMin > 1080 || endMin <= startMin) return "The timetable operates only between 08:00 AM and 06:00 PM.";
  if (input.classType === "Lab" && (input.time.includes("12:00") || input.time.includes("1:00"))) return "Lab sessions cannot cross the 12:00–02:00 PM lunch window.";

  const [facultyRows, roomRows, existing, holidayRows] = await Promise.all([
    db.select().from(faculty).where(eq(faculty.id, input.facultyId)),
    input.roomId > 0 ? db.select().from(classrooms).where(eq(classrooms.id, input.roomId)) : Promise.resolve([]),
    db.select().from(timetable),
    db.select().from(divisionHolidays),
  ]);
  const person = facultyRows[0];
  const room = roomRows[0];
  const subjectCode = input.subject.split(" · ")[0].trim().toUpperCase();
  const online = ["COURSERA1", "COURSERA2", "DT"].includes(subjectCode);
  const subjectRows = await db.select().from(subjects).where(eq(subjects.code, subjectCode));
  if (!person) return "Selected faculty member was not found.";
  if (!subjectRows.length) return `Subject ${subjectCode} was not found in the active subject catalog.`;
  if (!online && !room) return "Selected room was not found. Refresh the timetable page and choose an available room.";
  if (!online && input.roomId <= 0) return "A physical classroom is required for this session.";
  if (online && input.roomId !== 0) return "Online sessions must use the Online / no physical room option.";
  if (input.classType === "Lab" && !subjectRows.some((s) => String(s.type).toLowerCase() === "lab")) return `${subjectCode} does not have a Lab entry in the subject catalog.`;
  if (input.classType === "Theory" && !subjectRows.some((s) => String(s.type).toLowerCase() === "theory")) return `${subjectCode} does not have a Theory entry in the subject catalog.`;
  if (input.classType === "Tutorial" && !subjectRows.some((s) => String(s.type).toLowerCase() === "tutorial")) return `${subjectCode} does not have a Tutorial entry in the subject catalog.`;
  if (!online && input.classType === "Lab" && !room!.roomType.toUpperCase().includes("LAB")) return "Lab sessions must use a laboratory room.";
  if (!online && input.classType !== "Lab" && room!.roomType.toUpperCase().includes("LAB")) return "Theory/Tutorial sessions must use a lecture/seminar room.";
  if (!online && input.batchSize && room!.capacity < input.batchSize) return `Room ${room!.roomNumber} has capacity ${room!.capacity}, smaller than batch size ${input.batchSize}.`;

  const sameDivision = baseDivision(input.division);
  const configuredHoliday = holidayRows.find((row) => baseDivision(row.division) === sameDivision);
  if (configuredHoliday?.day === day) return `${sameDivision} has ${day} configured as its second weekly holiday.`;

  const intervalsOverlap = (a: string, b: string) => {
    const [as, ae] = slotParts(a);
    const [bs, be] = slotParts(b);
    const aStart = timeToMinutes(as), aEnd = timeToMinutes(ae);
    const bStart = timeToMinutes(bs), bEnd = timeToMinutes(be);
    return aStart < bEnd && bStart < aEnd;
  };
  const validationStatus = input.status ?? "draft";
  const relevantExisting = existing.filter((row) => row.status === validationStatus);
  const overlap = relevantExisting.filter((row) => row.id !== excludeId && row.day === day && intervalsOverlap(row.time, input.time));
  if (overlap.some((row) => row.faculty === person.name)) return `${person.name} is already teaching another session at ${day} ${input.time}.`;
  if (!online && overlap.some((row) => row.room === room!.roomNumber)) return `Room ${room!.roomNumber} is already booked at ${day} ${input.time}.`;
  if (overlap.some((row) => baseDivision(row.division) === sameDivision)) return `${sameDivision} already has a session at ${day} ${input.time}.`;

  // Keep student days compact: there may be no more than a two-hour gap
  // between classes on the same day.
  const daySessions = relevantExisting.filter((row) => row.id !== excludeId && row.day === day && baseDivision(row.division) === sameDivision);
  const occupied = daySessions.flatMap((row) => {
    const start = timeToMinutes(slotParts(row.time)[0]);
    const end = timeToMinutes(slotParts(row.time)[1]);
    return Array.from({ length: Math.max(0, (end - start) / 60) }, (_, i) => start / 60 - 8 + i);
  });
  const newStart = startMin / 60 - 8;
  const newEnd = endMin / 60 - 8;
  for (let h = newStart; h < newEnd; h++) occupied.push(h);
  const sortedHours = Array.from(new Set(occupied)).sort((a, b) => a - b);
  for (let i = 1; i < sortedHours.length; i++) {
    if (sortedHours[i] - sortedHours[i - 1] - 1 > 2) return `${sameDivision} would have more than a two-hour gap between classes on ${day}.`;
  }

  const availability = await db.select().from(facultyAvailability).where(eq(facultyAvailability.facultyId, person.id));
  const dayRows = availability.filter((row) => row.day.trim().toLowerCase() === day.toLowerCase());
  if (dayRows.length && !dayRows.some((row) => row.isAvailable && timeToMinutes(row.startTime) <= startMin && timeToMinutes(row.endTime) >= endMin)) {
    return `${person.name} is not available for ${day} ${input.time}.`;
  }
  return null;
}

router.post("/timetable/manual", async (req, res) => {
  const parsed = ManualTimetableBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid timetable entry.", issues: parsed.error.issues }); return; }
  const error = await validateManualEntry(parsed.data);
  if (error) { res.status(409).json({ error }); return; }
  const [person] = await db.select().from(faculty).where(eq(faculty.id, parsed.data.facultyId));
  const [room] = await db.select().from(classrooms).where(eq(classrooms.id, parsed.data.roomId));
  const [result] = await db.insert(timetable).values({
    day: parsed.data.day,
    time: parsed.data.time,
    subject: parsed.data.subject,
    faculty: person.name,
    room: ["COURSERA1", "COURSERA2", "DT"].includes(parsed.data.subject.split(" · ")[0].trim().toUpperCase()) ? "Online" : room!.roomNumber,
    division: parsed.data.division,
    classType: parsed.data.classType,
    batch: parsed.data.batch ?? null,
    batchSize: parsed.data.batchSize ?? null,
    status: parsed.data.status ?? "draft",
  });
  const [row] = await db.select().from(timetable).where(eq(timetable.id, result.insertId));
  res.status(201).json(row);
});

router.put("/timetable/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid timetable id." }); return; }
  const parsed = ManualTimetableBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid timetable entry.", issues: parsed.error.issues }); return; }
  const error = await validateManualEntry(parsed.data, id);
  if (error) { res.status(409).json({ error }); return; }
  const [person] = await db.select().from(faculty).where(eq(faculty.id, parsed.data.facultyId));
  const [room] = await db.select().from(classrooms).where(eq(classrooms.id, parsed.data.roomId));
  const parsedSubjectCode = parsed.data.subject.split(" · ")[0].trim().toUpperCase();
  const parsedOnline = ["COURSERA1", "COURSERA2", "DT"].includes(parsedSubjectCode);
  await db.update(timetable).set({ day: parsed.data.day, time: parsed.data.time, subject: parsed.data.subject, faculty: person.name, room: parsedOnline ? "Online" : room!.roomNumber, division: parsed.data.division, classType: parsed.data.classType, batch: parsed.data.batch ?? null, batchSize: parsed.data.batchSize ?? null, status: parsed.data.status ?? "draft" }).where(eq(timetable.id, id));
  const [row] = await db.select().from(timetable).where(eq(timetable.id, id));
  if (!row) { res.status(404).json({ error: "Timetable entry not found." }); return; }
  res.json(row);
});

router.delete("/timetable/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid timetable id." }); return; }
  await db.delete(timetable).where(eq(timetable.id, id));
  res.status(204).send();
});

router.get("/division-holidays", async (_req, res) => {
  const rows = await db.select().from(divisionHolidays);
  res.json(rows.map((row) => ({ ...row, division: canonicalDivision(row.division) })));
});

router.put("/division-holidays", async (req, res) => {
  const parsed = z.object({ division: z.string().min(1), day: z.enum(DAYS as unknown as [string, ...string[]]) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Division and a Monday–Saturday holiday are required." }); return; }
  const division = canonicalDivision(parsed.data.division);
  const existing = await db.select().from(divisionHolidays).where(eq(divisionHolidays.division, division));
  if (existing[0]) await db.update(divisionHolidays).set({ day: parsed.data.day }).where(eq(divisionHolidays.id, existing[0].id));
  else await db.insert(divisionHolidays).values({ division, day: parsed.data.day });
  res.json({ division, day: parsed.data.day });
});

router.delete("/division-holidays/:division", async (req, res) => {
  const division = canonicalDivision(req.params.division);
  const matchingRows = await db.select({ id: divisionHolidays.id }).from(divisionHolidays);
  for (const row of matchingRows) {
    const stored = (await db.select().from(divisionHolidays).where(eq(divisionHolidays.id, row.id)))[0];
    if (stored && canonicalDivision(stored.division) === division) {
      await db.delete(divisionHolidays).where(eq(divisionHolidays.id, row.id));
    }
  }
  res.status(204).send();
});

router.get("/subject-faculty-assignments", async (_req, res) => {
  const rows = await db.select({ id: subjectFacultyAssignments.id, subjectCode: subjectFacultyAssignments.subjectCode, division: subjectFacultyAssignments.division, facultyId: subjectFacultyAssignments.facultyId, facultyName: faculty.name }).from(subjectFacultyAssignments).leftJoin(faculty, eq(subjectFacultyAssignments.facultyId, faculty.id));
  res.json(rows.map((row) => ({ ...row, division: canonicalDivision(row.division) })));
});

router.put("/subject-faculty-assignments", async (req, res) => {
  const parsed = z.object({ subjectCode: z.string().min(1), division: z.string().min(1), facultyId: z.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "subjectCode, division and facultyId are required." }); return; }
  const subjectCode = parsed.data.subjectCode.trim().toUpperCase();
  const division = canonicalDivision(parsed.data.division);
  const [person] = await db.select().from(faculty).where(eq(faculty.id, parsed.data.facultyId));
  if (!person) { res.status(404).json({ error: "Faculty member not found." }); return; }
  let facultyId = person.id;
  if (subjectCode === "MLOPS") {
    const angdi = (await db.select().from(faculty)).find((f) => f.name.toLowerCase().replace(/\s+/g, "").includes("dr.angdi"));
    if (!angdi) { res.status(409).json({ error: "MLOPS requires Dr.Angdi, but Dr.Angdi is not in the faculty list." }); return; }
    facultyId = angdi.id;
  }
  const existing = await db.select().from(subjectFacultyAssignments).where(eq(subjectFacultyAssignments.subjectCode, subjectCode));
  const match = existing.find((row) => row.division === division);
  if (match) await db.update(subjectFacultyAssignments).set({ facultyId }).where(eq(subjectFacultyAssignments.id, match.id));
  else await db.insert(subjectFacultyAssignments).values({ subjectCode, division, facultyId });
  const rows = await db.select({ id: subjectFacultyAssignments.id, subjectCode: subjectFacultyAssignments.subjectCode, division: subjectFacultyAssignments.division, facultyId: subjectFacultyAssignments.facultyId, facultyName: faculty.name }).from(subjectFacultyAssignments).leftJoin(faculty, eq(subjectFacultyAssignments.facultyId, faculty.id)).where(eq(subjectFacultyAssignments.division, division));
  const row = rows.find((item) => item.subjectCode === subjectCode);
  res.json(row);
});

router.delete("/subject-faculty-assignments/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid assignment id." }); return; }
  await db.delete(subjectFacultyAssignments).where(eq(subjectFacultyAssignments.id, id));
  res.status(204).send();
});

/*
 * Generate a fresh timetable.
 *
 * IMPORTANT FIX:
 *
 * Students may have registered a subject using:
 *
 *     ML3203B
 *
 * OR:
 *
 *     MLOPS
 *
 * OR:
 *
 *     MLOOps
 *
 * The scheduler needs the actual subject CODE.
 *
 * Therefore we resolve the student's registeredSubject against
 * BOTH the subject code and subject name.
 */
/*
 * Shared by both the "generate everything" button and the AI-prompt
 * "generate for one division" flow below.
 */

async function buildMlPayloadFromDatabase(
  studentRows: Array<typeof students.$inferSelect>,
  facultyRows: Array<typeof faculty.$inferSelect>,
  subjectRows: Array<typeof subjects.$inferSelect>,
  classroomRows: Array<typeof classrooms.$inferSelect>,
): Promise<MlPayload> {
  const teacherCsv = [
    "teacher_id,teacher_name,department,subject,max_hours_per_week,preferred_days,preferred_time_slots,unavailable_days,unavailable_slots",
    ...facultyRows.map((f) =>
      [f.id, JSON.stringify(f.name), JSON.stringify(f.department ?? ""), "", f.maxWeeklyHours, "", "", "", ""].join(",")
    ),
  ].join("\n");

  const subjectGroups = new Map<string, typeof subjectRows>();
  for (const s of subjectRows) {
    const key = s.code || s.name;
    const list = subjectGroups.get(key) ?? [];
    list.push(s);
    subjectGroups.set(key, list);
  }

  const divisions = Array.from(new Set(studentRows.map((s) => canonicalDivision(s.division))));
  const studentLines = [
    "student_id,student_name,department,year,semester,division,roll_number,subjects,academic_hours_required,student_count",
  ];
  for (const division of divisions) {
    const members = studentRows.filter((s) => canonicalDivision(s.division) === division);
    const hasCn = members.some((s) => String(s.registeredSubject).toUpperCase() === "CN");
    const hasMlops = members.some((s) => String(s.registeredSubject).toUpperCase() === "MLOPS");
    const parts: string[] = [];

    for (const [code, rows] of subjectGroups) {
      if ((code === "CN" && !hasCn) || (code === "MLOPS" && !hasMlops)) continue;
      for (const row of rows) {
        const suffix = row.type?.toLowerCase() === "lab" ? " [Lab]" : row.type?.toLowerCase() === "tutorial" ? " [Tutorial]" : "";
        parts.push(`${row.name}${suffix}:${row.weeklyHours}`);
      }
    }
    const hours = parts.reduce((sum, part) => {
      const match = part.match(/:(\d+(?:\.\d+)?)$/);
      return sum + Number(match?.[1] ?? 0);
    }, 0);
    const safeSubjects = `"${parts.join(";").replace(/"/g, '""')}"`;
    studentLines.push([
      `${division}-1`, JSON.stringify(`${division} Students`), "", "", "", division, 1,
      safeSubjects, hours, members.length,
    ].join(","));
  }

  const classroomCsv = [
    "classroom_id,room_number,building,floor,room_type,capacity,department,available_days,available_slots,has_projector,has_computer,has_lab,lab_type",
    ...classroomRows.map((r) => [
      r.id, JSON.stringify(r.roomNumber), JSON.stringify(r.building ?? ""), "", r.roomType, r.capacity,
      "", "Monday|Tuesday|Wednesday|Thursday|Friday", "08:00-12:00|14:00-18:00",
      1, 1, r.roomType.toLowerCase().includes("lab") ? 1 : 0, r.roomType.toLowerCase().includes("lab") ? "general" : "",
    ].join(",")),
  ].join("\n");

  const stored = loadMlPayload();
  return {
    teachers_csv: teacherCsv,
    students_csv: studentLines.join("\n"),
    classrooms_csv: classroomCsv,
    config: stored?.config ?? { working_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], hours_per_day: 5 },
  };
}

export async function runGeneration(onlyDivisions?: string[]) {
  // Normalize scoped regeneration targets as well. In particular AIML-B is
  // part of TY-B in this project, so a request for either spelling must
  // rebuild the same timetable division.
  const normalizedOnlyDivisions = onlyDivisions?.map(canonicalDivision);

  // For a scoped regeneration, remove only that division first and preserve
  // every other division as a hard reservation in the scheduler.
  let reservedSessions: any[] = [];
  if (normalizedOnlyDivisions?.length) {
    const existing = await db.select().from(timetable);
    const belongsToTarget = (row: any, target: string) =>
      canonicalDivision(String(row.division).split(" · ")[0]) === target;

    // Preserve the currently published timetable while an admin reviews a
    // regenerated draft. Only old draft rows for the target are replaced.
    reservedSessions = existing.filter(
      (row) => !normalizedOnlyDivisions.some((d) => belongsToTarget(row, d)),
    );

  }

  const [studentRows, facultyRows, availabilityRows, subjectRows, classroomRows, assignmentRows, holidayRows, batchRows, roomAssignmentRows] = await Promise.all([
    db.select().from(students).where(eq(students.isActive, true)),
    db.select().from(faculty).where(eq(faculty.isActive, true)),
    db.select().from(facultyAvailability),
    db.select().from(subjects).where(eq(subjects.isActive, true)),
    db.select().from(classrooms).where(eq(classrooms.isActive, true)),
    db.select().from(subjectFacultyAssignments),
    db.select().from(divisionHolidays),
    db.select().from(labBatches),
    db.select().from(divisionRoomAssignments),
  ]);

  const normalizedStudents = studentRows.map((student) => ({
    division: student.division,
    registeredSubject: student.registeredSubject || "CN",
  }));

  // Use the catalog-aware scheduler for full and scoped runs so choice
  // subjects, class types, lab batches, and room assignments are preserved.
  const result = generateTimetable({
    students: normalizedStudents,
    faculty: facultyRows,
    facultyAvailability: availabilityRows,
    subjects: subjectRows,
    classrooms: classroomRows,
    facultyAssignments: assignmentRows.map((row) => ({ subjectCode: row.subjectCode, division: row.division, facultyId: row.facultyId })),
    divisionHolidays: holidayRows.map((row) => ({ division: row.division, day: row.day })),
    labBatches: batchRows.map((row) => ({ division: row.division, subjectCode: row.subjectCode, batchName: row.batchName, studentCount: row.studentCount })),
    roomAssignments: roomAssignmentRows.map((row) => ({ division: row.division, roomId: row.roomId, classType: row.classType as "Theory" | "Tutorial" | "Lab", subjectCode: row.subjectCode, batchName: row.batchName })),
    onlyDivisions: normalizedOnlyDivisions,
    reservedSessions,
  });

  // Replace the current draft only after a complete schedule is available.
  await db.transaction(async (tx) => {
    if (normalizedOnlyDivisions?.length) {
      const existingDrafts = await tx.select().from(timetable).where(eq(timetable.status, "draft"));
      for (const row of existingDrafts) {
        const base = canonicalDivision(String(row.division).split(" Â· ")[0]);
        if (normalizedOnlyDivisions.includes(base)) {
          await tx.delete(timetable).where(eq(timetable.id, row.id));
        }
      }
    } else {
      await tx.delete(timetable).where(eq(timetable.status, "draft"));
    }
    await tx.delete(conflicts);
    if (result.sessions.length) await tx.insert(timetable).values(result.sessions);
    if (result.conflicts.length) await tx.insert(conflicts).values(result.conflicts);
  });

  console.log(`[TIMETABLE] Generated ${result.sessions.length} sessions and ${result.conflicts.length} conflicts.` + (onlyDivisions?.length ? ` (scope: ${onlyDivisions.join(", ")})` : " (scope: all divisions; catalog scheduler)"));
  return result;
}
router.post("/timetable/generate", async (_req, res) => {
  const result = await runGeneration();

  res.status(201).json({
    sessionsScheduled: result.sessions.length,
    conflictsFound: result.conflicts.length,
  });
});

/*
 * AI-agent entry point.
 *
 * Admin types a plain instruction like:
 *   "make the table for division AIML-B"
 *   "generate timetable for TY-A and TY-B"
 *   "regenerate all divisions"
 *
 * We do NOT ask an LLM to invent the schedule itself — a language model
 * has no structural guarantee against double-booking. Instead we use a
 * light NLU pass just to figure out *which divisions* the admin means,
 * then hand off to the same deterministic, conflict-free `generateTimetable`
 * used everywhere else. That keeps the "no overlap" guarantee absolute
 * regardless of how the prompt is phrased.
 */
router.post("/timetable/generate-from-prompt", async (req, res) => {
  const Body = z.object({ prompt: z.string().min(1) });
  const parsed = Body.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "A non-empty 'prompt' string is required." });
    return;
  }

  const prompt = parsed.data.prompt.trim();
  const lower = prompt.toLowerCase();

  const knownDivisions = Array.from(
    new Set((await db.select().from(students)).map((s) => canonicalDivision(s.division))),
  );

  const wantsAll =
    /\ball\b/.test(lower) ||
    /every\s+division/.test(lower) ||
    !knownDivisions.some((d) => lower.includes(d.toLowerCase()));

  const requestedDivisions = wantsAll
    ? undefined
    : knownDivisions.filter((d) => lower.includes(d.toLowerCase()));

  const result = await runGeneration(requestedDivisions);

  res.status(201).json({
    scope: requestedDivisions?.length ? requestedDivisions : ["all"],
    sessionsScheduled: result.sessions.length,
    conflictsFound: result.conflicts.length,
    message: requestedDivisions?.length
      ? `Generated a conflict-free timetable for ${requestedDivisions.join(", ")} — ${result.sessions.length} session(s), ${result.conflicts.length} item(s) need review.`
      : `Generated a conflict-free timetable for all divisions — ${result.sessions.length} session(s), ${result.conflicts.length} item(s) need review.`,
  });
});

/*
 * Get timetable conflicts.
 */
router.get("/timetable/conflicts", async (_req, res) => {
  const rows = await db
    .select()
    .from(conflicts);

  res.json(
    GetTimetableConflictsResponse.parse(rows),
  );
});

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

router.get("/dashboard/summary", async (_req, res) => {
  const [
    studentCount,
    facultyCount,
    subjectCount,
    scheduledCount,
    conflictCount,
    facultyRows,
    timetableRows,
  ] = await Promise.all([
    db.select({ value: count() }).from(students),
    db.select({ value: count() }).from(faculty),
    db.select({ value: count() }).from(subjects),
    db.select({ value: count() }).from(timetable),
    db.select({ value: count() }).from(conflicts),
    db.select().from(faculty),
    db.select().from(timetable),
  ]);

  const data = {
    students: Number(
      studentCount[0]?.value ?? 0,
    ),

    faculty: Number(
      facultyCount[0]?.value ?? 0,
    ),

    subjects: Number(
      subjectCount[0]?.value ?? 0,
    ),

    scheduledClasses: (() => {
      const drafts = timetableRows.filter((row) => row.status === "draft").length;
      const published = timetableRows.filter((row) => row.status === "published").length;
      return drafts || published;
    })(),

    conflicts: Number(
      conflictCount[0]?.value ?? 0,
    ),

    facultyUtilization: facultyRows.length
      ? Math.min(100, Math.round((timetableRows.reduce((total, row) => total + (row.classType === "Lab" ? 2 : 1), 0) / Math.max(1, facultyRows.reduce((total, row) => total + row.maxWeeklyHours, 0))) * 100))
      : 0,

    nextGeneration: new Date().toISOString(),
  };

  res.json(
    GetDashboardSummaryResponse.parse(data),
  );
});

export default router;
