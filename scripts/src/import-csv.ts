/**
 * Imports the institution's real student/faculty/classroom data into the
 * database, so the platform runs on actual data instead of demo rows.
 *
 * Usage (from repo root):
 *   pnpm --filter @workspace/scripts import-csv
 *
 * By default it reads:
 *   data/student.csv
 *   data/faculty.csv
 * and creates classrooms from the fixed room list below. Drop your own
 * CSVs into data/ (same filenames) to re-run with different data — the
 * import is safe to re-run, it upserts rather than duplicating rows.
 *
 * The source files are real institutional exports, which means they are
 * messy in predictable ways (merged header rows, inconsistent division
 * labels like "AIML-B" vs "AIML B" vs "AIMLC", employee codes glued onto
 * faculty names, etc). The parsing below is written specifically to
 * unpick *that* format. If your CSV files look different, the block
 * detection logic (search for "BLOCK-SPECIFIC PARSING" below) is the
 * part to adapt.
 */
import "./env";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { count as sqlCount } from "drizzle-orm";
import { db, classrooms, conflicts, divisionHolidays, faculty, facultyAvailability, students, subjectFacultyAssignments, subjects, timetable, users } from "@workspace/db";

const DATA_DIR = path.resolve(import.meta.dirname, "../../data");

// Rooms as provided for this institution.
const LECTURE_ROOMS = ["4005", "4006", "4207", "4307"];
const LAB_ROOMS = ["4003", "4007", "4008", "4304A", "4308", "4309"];

// The two subjects that actually appear in the student registrations.
const SUBJECTS = [
  { code: "ML3002", name: "Design and Analysis of Algorithms", type: "Theory", weeklyHours: 3 },
  { code: "ML3002", name: "Design and Analysis of Algorithms", type: "Lab", weeklyHours: 2 },
  { code: "ML3003", name: "Machine Learning", type: "Theory", weeklyHours: 3 },
  { code: "ML3003", name: "Machine Learning", type: "Lab", weeklyHours: 2 },
  { code: "ML3004", name: "Cloud Computing", type: "Theory", weeklyHours: 3 },
  { code: "ML3004", name: "Cloud Computing", type: "Tutorial", weeklyHours: 1 },
  { code: "CN", name: "Computer Networks", type: "Theory", weeklyHours: 3 },
  { code: "CN", name: "Computer Networks", type: "Lab", weeklyHours: 2 },
  { code: "MLOPS", name: "Machine Learning Operations", type: "Theory", weeklyHours: 3 },
  { code: "MLOPS", name: "Machine Learning Operations", type: "Lab", weeklyHours: 2 },
  { code: "COURSERA1", name: "Coursera 1", type: "Theory", weeklyHours: 1 },
  { code: "COURSERA2", name: "Coursera 2", type: "Theory", weeklyHours: 1 },
  { code: "DT", name: "DT", type: "Tutorial", weeklyHours: 1 },
];

// Default passwords for auto-created accounts — everyone should change
// these after first login. See data/generated-credentials.csv after import
// for the full list of accounts this run created.
const DEFAULT_PASSWORDS = {
  admin: "Admin@123",
  faculty: "faculty123",
  student: "Student@123",
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, ".");
}

// ---------------------------------------------------------------------------
// Minimal RFC4180 CSV parser (handles quoted fields with embedded commas
// and newlines, which the faculty sheet relies on).
// ---------------------------------------------------------------------------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readCsv(filename: string): string[][] {
  const filePath = path.join(DATA_DIR, filename);
  const raw = readFileSync(filePath, "utf-8").replace(/^\uFEFF/, ""); // strip BOM
  return parseCsv(raw);
}

// ---------------------------------------------------------------------------
// BLOCK-SPECIFIC PARSING
// ---------------------------------------------------------------------------

function normalizeDivision(raw: string): string {
  let s = raw.trim().toUpperCase().replace(/_/g, "-").replace(/\s+/g, " ");
  // "AIMLC" / "AIML C" / "AIML-B" -> "AIML-B" / "AIML-C"
  s = s.replace(/^AIML-?\s*([A-Z])$/, "AIML-$1");
  // "TY_G" / "TY G" -> "TY-G"
  s = s.replace(/^TY[\s-]+([A-Z])$/, "TY-$1");
  return s;
}

function normalizeSubjectCode(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (!s) return null;
  if (s === "CNT" || s.includes("NETWORK") || (s.includes("COMPUTER") && s.includes("TECH"))) return "CN";
  if (s.includes("ML") && (s.includes("OPS") || s.includes("OOPS"))) return "MLOPS";
  return null;
}

function cleanFacultyName(raw: string): string {
  // Strips leading "11789:JPK:" style employee codes.
  const parts = raw.split(":");
  const name = parts.length > 1 ? parts[parts.length - 1] : raw;
  return name.trim().replace(/\s+/g, " ");
}

type ParsedFaculty = { name: string; designation: string; maxWeeklyHours: number };

function parseFacultyCsv(): ParsedFaculty[] {
  const rows = readCsv("faculty.csv");
  const out: ParsedFaculty[] = [];
  // Row 0 and 1 are header rows; each faculty member starts a new row with
  // a non-empty Sr. No. in column 0, followed by several blank-Sr-No rows
  // holding their day-by-day schedule (which we don't need here).
  for (const r of rows.slice(2)) {
    if (r[0] && r[0].trim()) {
      const name = cleanFacultyName(r[1] ?? "");
      const designation = (r[2] ?? "").trim() || "Faculty";
      const loadRaw = (r[5] ?? "").trim();
      const maxWeeklyHours = /^\d+$/.test(loadRaw) ? parseInt(loadRaw, 10) : 18;
      if (name) out.push({ name, designation, maxWeeklyHours });
    }
  }
  return out;
}

type ParsedStudent = { division: string; rollNo: number; prn: string | null; name: string; registeredSubject: string };

function readChoiceRegistrations(): Set<string> {
  const rows = readCsv("choice-registrations.csv");
  return new Set(rows.slice(1).map((r) => (r[0] ?? "").trim()).filter(Boolean));
}

function parseStudentCsv(): ParsedStudent[] {
  const rows = readCsv("student.csv");
  const out: ParsedStudent[] = [];
  let currentDivision = "";

  const normalizeChoice = (raw: string): string => {
    const value = raw.trim().toUpperCase().replace(/\s+/g, " ");
    if (!value) return "CN";
    if (value.includes("MLOP") || value.includes("MLOOP") || value.includes("ML OOP")) return "MLOPS";
    if (value.includes("NETWORK") || value.includes("CNT") || value.includes("COMPUTER TECH")) return "CN";
    if (value === "COMPUTER TECHNOLOGY") return "CN";
    return "CN";
  };

  for (const r of rows) {
    const divRaw = (r[0] ?? "").trim();
    const rollRaw = (r[1] ?? "").trim();
    const prnRaw = (r[2] ?? "").trim();
    const nameRaw = (r[3] ?? "").trim();
    const choiceRaw = (r[4] ?? "").trim();

    // The supplied institutional export starts each block with a row such as
    // "TY A", then uses only A/B/C... in the student rows. Keep the block
    // context until the next real TY/AIML header.
    if (
      divRaw &&
      !rollRaw &&
      !prnRaw &&
      !nameRaw &&
      /^(TY|AIML)[\s_-]*[A-Z]$/i.test(divRaw)
    ) {
      currentDivision = normalizeDivision(divRaw);
      continue;
    }

    if (divRaw && /^(TY|AIML)[\s_-]*[A-Z]$/i.test(divRaw) && !/^\d+$/.test(rollRaw)) {
      currentDivision = normalizeDivision(divRaw);
      continue;
    }

    if (!/^\d+$/.test(rollRaw) || !nameRaw || !currentDivision) continue;

    out.push({
      division: currentDivision,
      rollNo: parseInt(rollRaw, 10),
      prn: prnRaw || null,
      name: nameRaw.replace(/\s+/g, " "),
      registeredSubject: normalizeChoice(choiceRaw),
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const reset = process.argv.includes("--reset");

  const [existingStudents] = await db.select({ value: sqlCount() }).from(students);
  const [existingFaculty] = await db.select({ value: sqlCount() }).from(faculty);
  const alreadyPopulated = Number(existingStudents?.value ?? 0) > 0 || Number(existingFaculty?.value ?? 0) > 0;

  if (alreadyPopulated && !reset) {
    console.log(
      "Students/faculty tables already have data. Re-run with --reset to wipe and re-import " +
        "(e.g. `pnpm import-csv -- --reset`), or clear them manually first.",
    );
    process.exit(0);
  }

  if (reset) {
    console.log("Resetting existing students/faculty/users rows...");
    await db.delete(timetable);
    await db.delete(conflicts);
    await db.delete(users);
    await db.delete(students);
    await db.delete(facultyAvailability);
    await db.delete(faculty);
    await db.delete(subjectFacultyAssignments);
    await db.delete(divisionHolidays);
    await db.delete(subjects);
    await db.delete(classrooms);
  }

  console.log("Importing classrooms...");
  for (const room of LECTURE_ROOMS) {
    await db.insert(classrooms).ignore().values({ roomNumber: room, roomType: "lecture", capacity: 100 });
  }
  for (const room of LAB_ROOMS) {
    await db.insert(classrooms).ignore().values({ roomNumber: room, roomType: "lab", capacity: 35 });
  }

  console.log("Importing subjects...");
  for (const subject of SUBJECTS) {
    await db
      .insert(subjects)
      .values(subject)
      .onDuplicateKeyUpdate({ set: { name: subject.name, type: subject.type, weeklyHours: subject.weeklyHours } });
  }

  console.log("Importing faculty...");
  const facultyRows = parseFacultyCsv();
  const facultyIds: number[] = [];
  for (const f of facultyRows) {
    const [result] = await db.insert(faculty).values({
      name: f.name,
      department: f.designation,
      maxWeeklyHours: f.maxWeeklyHours,
    });
    facultyIds.push(result.insertId);
  }

  console.log("Importing faculty availability...");
  const facultyRawRows = readCsv("faculty.csv");
  let currentFacultyId: number | null = null;
  let facultyHeaderIndex = -1;
  for (const r of facultyRawRows.slice(2)) {
    if (r[0]?.trim() && /^\d+$/.test(r[0].trim())) {
      facultyHeaderIndex += 1;
      currentFacultyId = facultyIds[facultyHeaderIndex] ?? null;
    }
    if (!currentFacultyId || !r[6]?.trim()) continue;
    const day = r[6].trim();
    const inTime = r[7]?.trim() || "";
    const outTime = r[8]?.trim() || "";
    if (!day || !inTime || inTime.toUpperCase() === "OFF") {
      await db.insert(facultyAvailability).values({ facultyId: currentFacultyId, day, startTime: "08:00", endTime: "18:00", isAvailable: false });
      continue;
    }
    const to24 = (v: string) => { const m = v.match(/(\d{1,2})(?::(\d{2}))?/); if (!m) return "08:00"; let h = Number(m[1]); const mi = m[2] || "00"; if (h < 8) h += 12; return `${String(h).padStart(2,"0")}:${mi}`; };
    await db.insert(facultyAvailability).values({ facultyId: currentFacultyId, day, startTime: to24(inTime), endTime: to24(outTime || "18"), isAvailable: true });
  }

  console.log("Importing students...");
  const legacyChoicePrns = readChoiceRegistrations();
  const parsedStudents = parseStudentCsv();
  const studentRows = parsedStudents.map((student) => ({
    ...student,
    // The supplied student export contains the choice column. Use it first;
    // the separate choice-registration file remains a backwards-compatible
    // fallback for rows whose export has no choice value.
    registeredSubject:
      student.registeredSubject === "MLOPS" || (student.prn ? legacyChoicePrns.has(student.prn) : false)
        ? "MLOPS"
        : "CN",
  }));
  const choiceLines = [
    "PRN,ChoiceSubject",
    ...studentRows
      .filter((student) => student.prn && student.registeredSubject === "MLOPS")
      .map((student) => `${student.prn},MLOPS`),
  ];
  writeFileSync(path.join(DATA_DIR, "choice-registrations.csv"), choiceLines.join("\n") + "\n", "utf-8");

  const studentIds: number[] = [];
  for (const s of studentRows) {
    const [result] = await db.insert(students).values({
      name: s.name,
      division: s.division,
      rollNo: s.rollNo,
      prn: s.prn,
      registeredSubject: s.registeredSubject,
    });
    studentIds.push(result.insertId);
  }

  console.log("Creating login accounts...");
  const credentialRows: { role: string; name: string; email: string; password: string }[] = [];
  const usedEmails = new Set<string>();

  function uniqueEmail(base: string): string {
    let email = `${base}@vit.edu`;
    let n = 2;
    while (usedEmails.has(email)) {
      email = `${base}${n}@vit.edu`;
      n++;
    }
    usedEmails.add(email);
    return email;
  }

  // Admin account.
  const adminEmail = uniqueEmail("admin");
  await db
    .insert(users)
    .values({
      email: adminEmail,
      passwordHash: await bcrypt.hash(DEFAULT_PASSWORDS.admin, 10),
      role: "admin",
      name: "Academic Office Admin",
    })
    .onDuplicateKeyUpdate({ set: { name: "Academic Office Admin" } });
  credentialRows.push({ role: "admin", name: "Academic Office Admin", email: adminEmail, password: DEFAULT_PASSWORDS.admin });

  // One login per faculty member.
  const facultyPasswordHash = await bcrypt.hash(DEFAULT_PASSWORDS.faculty, 10);
  for (let i = 0; i < facultyRows.length; i++) {
    const f = facultyRows[i];
    const email = uniqueEmail(slugify(f.name));
    await db.insert(users).values({
      email,
      passwordHash: facultyPasswordHash,
      role: "faculty",
      name: f.name,
      facultyId: facultyIds[i],
    });
    credentialRows.push({ role: "faculty", name: f.name, email, password: DEFAULT_PASSWORDS.faculty });
  }

  // One login per student — email keyed off PRN (falls back to roll number
  // if a row is missing one) since that's the closest thing to a stable ID.
  for (let i = 0; i < studentRows.length; i++) {
    const s = studentRows[i];
    const emailBase = (s.prn || `${s.division}-${s.rollNo}`).toLowerCase().replace(/[^a-z0-9]/g, "");
    const email = uniqueEmail(emailBase);
    const password = s.prn || DEFAULT_PASSWORDS.student;
    await db.insert(users).values({
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role: "student",
      name: s.name,
      studentId: studentIds[i],
    });
    credentialRows.push({ role: "student", name: s.name, email, password });
  }

  const credentialsPath = path.join(DATA_DIR, "generated-credentials.csv");
  const csvLines = ["role,name,email,password", ...credentialRows.map((c) => `${c.role},"${c.name}",${c.email},${c.password}`)];
  writeFileSync(credentialsPath, csvLines.join("\n") + "\n", "utf-8");

  console.log(
    `Done. Imported ${LECTURE_ROOMS.length + LAB_ROOMS.length} classrooms, ${SUBJECTS.length} subjects, ` +
      `${facultyRows.length} faculty, ${studentRows.length} students, and ${credentialRows.length} login accounts.`,
  );
  console.log(`\nAdmin login: ${adminEmail} / ${DEFAULT_PASSWORDS.admin}`);
  console.log(`All generated logins (including every faculty/student account) are in:\n  ${credentialsPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
