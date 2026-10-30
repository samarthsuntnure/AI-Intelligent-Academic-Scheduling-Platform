import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { classrooms, faculty, students, subjects, timetable, labBatches } from "@workspace/db/schema";
import { requireRole } from "../lib/auth-middleware";

const router: IRouter = Router();

// A faculty member's own weekly teaching schedule — nothing else.
router.get("/me/faculty-schedule", requireRole("faculty"), async (req, res) => {
  const facultyId = req.user!.facultyId;
  if (!facultyId) {
    res.status(404).json({ error: "This account isn't linked to a faculty record." });
    return;
  }
  const [facultyRow] = await db.select().from(faculty).where(eq(faculty.id, facultyId));
  if (!facultyRow) {
    res.status(404).json({ error: "Faculty record not found." });
    return;
  }
  const sessions = (await db.select().from(timetable).where(eq(timetable.faculty, facultyRow.name)))
    .filter((session) => session.status === "published");
  res.json({ faculty: facultyRow, sessions });
});

/**
 * A lab session's `division` column is stored as `"<division> · Batch X"`
 * (see scheduler.ts's `placeWithFaculty` label) while Theory/Tutorial rows
 * use the bare division (or `"__SHARED_MLOPS__"` for the shared cohort).
 * This pulls the bare division back out so a student's own division can be
 * matched against BOTH kinds of row.
 */
function canonicalDivision(value: string): string {
  const v = value.trim().toUpperCase().replace(/_/g, "-").replace(/\s+/g, " ");
  const ty = v.match(/^TY\s*-?\s*([A-Z])$/);
  if (ty) return `TY-${ty[1]}`;
  const aiml = v.match(/^AIML\s*-?\s*([A-Z])$/);
  if (aiml) return aiml[1] === "B" ? "TY-B" : `AIML-${aiml[1]}`;
  return v;
}

function baseDivisionOf(division: string): string {
  return canonicalDivision(division.split(" · ")[0]);
}

/**
 * The scheduler batches a lab population by lab-room capacity but never
 * records which specific student landed in which batch — it only creates
 * N same-sized batch *sessions* (see `batchesFor` in scheduler.ts). Per the
 * spec's own example ("1-35 = Batch 1, 36-70 = Batch 2 ..."), batch
 * membership is a deterministic function of roll-number order within the
 * relevant population, chunked by lab capacity. This mirrors that exactly
 * so a student's own batch can be computed on read instead of stored.
 */
async function labBatchLabelFor(
  studentId: number,
  population: { id: number; rollNo: number }[],
  division: string,
  subjectCode?: string,
): Promise<string | null> {
  const configured = (await db.select().from(labBatches))
    .filter((row) => canonicalDivision(row.division) === canonicalDivision(division))
    .filter((row) => (row.subjectCode || null) === (subjectCode || null))
    .sort((a, b) => a.batchName.localeCompare(b.batchName));

  const ordered = [...population].sort((a, b) => a.rollNo - b.rollNo || a.id - b.id);
  const index = ordered.findIndex((s) => s.id === studentId);
  if (index === -1) return null;

  if (configured.length) {
    let cursor = 0;
    for (const batch of configured) {
      const next = cursor + batch.studentCount;
      if (index < next) return batch.batchName;
      cursor = next;
    }
  }

  const labRoomRows = await db.select().from(classrooms);
  const labCapacity = Math.max(
    0,
    ...labRoomRows.filter((room) => room.roomType.toUpperCase().includes("LAB")).map((room) => room.capacity),
  );
  if (labCapacity <= 0) return null;
  const batchIndex = Math.floor(index / labCapacity);
  return `Batch ${String.fromCharCode(65 + batchIndex)}`;
}

// A student's timetable contains the common curriculum plus only that student's
// choice subject, and — critically — only THEIR OWN lab batch, never every
// batch running in parallel. The choice field is kept internal; it is not
// shown in the student directory UI.
router.get("/me/student-schedule", requireRole("student"), async (req, res) => {
  const studentId = req.user!.studentId;
  if (!studentId) { res.status(404).json({ error: "This account isn't linked to a student record." }); return; }
  const [studentRow] = await db.select().from(students).where(eq(students.id, studentId));
  if (!studentRow) { res.status(404).json({ error: "Student record not found." }); return; }

  const choice = (studentRow.registeredSubject || "CN").toUpperCase();
  const studentDivision = canonicalDivision(studentRow.division);

  // Use the same normalized cohort definition as the scheduler. AIML-B is
  // part of TY-B, so its students must share TY-B lab batches with the other
  // TY-B students rather than being batched as a separate 27-student group.
  const allStudents = await db.select({
    id: students.id,
    division: students.division,
    rollNo: students.rollNo,
    registeredSubject: students.registeredSubject,
  }).from(students);

  const divisionPopulation = allStudents
    .filter((s) => canonicalDivision(s.division) === studentDivision)
    .map(({ id, rollNo }) => ({ id, rollNo }));
  const divisionBatch = await labBatchLabelFor(studentRow.id, divisionPopulation, studentDivision);

  let choiceBatch: string | null = null;
  if (choice === "CN" || choice === "MLOPS") {
    const choicePopulation =
      choice === "MLOPS"
        ? allStudents
            .filter((s) => (s.registeredSubject || "").toUpperCase() === "MLOPS")
            .map(({ id, rollNo }) => ({ id, rollNo }))
        : allStudents
            .filter((s) => canonicalDivision(s.division) === studentDivision && (s.registeredSubject || "").toUpperCase() === "CN")
            .map(({ id, rollNo }) => ({ id, rollNo }));
    choiceBatch = await labBatchLabelFor(studentRow.id, choicePopulation, studentDivision, choice);
  }

  const all = (await db.select().from(timetable)).filter((session) => session.status === "published");
  const mySessions = all.filter((s) => {
    const base = baseDivisionOf(s.division);
    const sharedMLOPS = base === "__SHARED_MLOPS__";

    // Must be this student's own division, or the shared MLOPS cohort if
    // (and only if) they registered for MLOPS.
    if (sharedMLOPS) {
      if (choice !== "MLOPS") return false;
    } else if (base !== studentDivision) {
      return false;
    }

    const code = s.subject.split(" · ")[0].trim().toUpperCase();

    // Exclude the choice subject the student did NOT register for.
    if (code === "CN" && choice !== "CN") return false;
    if (code === "MLOPS" && choice !== "MLOPS") return false;

    // Labs run in parallel batches — only show this student's own batch.
    if (s.classType === "Lab") {
      if (code === "MLOPS") return s.batch !== null && s.batch === choiceBatch;
      if (code === "CN") return s.batch !== null && s.batch === choiceBatch;
      return s.batch !== null && s.batch === divisionBatch;
    }

    return true;
  });

  const choiceSubject = (await db.select().from(subjects).where(eq(subjects.code, choice)))[0] || null;
  const assignedFaculty = Array.from(new Set(mySessions.map((s) => s.faculty)));
  res.json({
    student: { ...studentRow, division: studentDivision },
    subject: choiceSubject,
    sessions: mySessions,
    assignedFaculty,
  });
});

export default router;
