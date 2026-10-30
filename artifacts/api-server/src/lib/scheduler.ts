/**
 * Deterministic VIT timetable scheduler.
 *
 * Rules:
 *  - Monday-Saturday, 08:00-18:00.
 *  - Sunday is always a holiday.
 *  - Every division gets one additional holiday.
 *  - Faculty availability is respected.
 *  - Faculty gets one lunch hour between 12:00 and 14:00.
 *
 * Subject structure:
 *  - DAA       : Theory 3 + Lab 2
 *  - ML        : Theory 3 + Lab 2
 *  - Cloud     : Theory 3 + Tutorial 1
 *  - CN        : Theory 3 + Lab 2
 *  - MLOPS     : Theory 3 + Lab 2
 *
 * Special:
 *  - CN and MLOPS are choice subjects.
 *  - MLOPS is ALWAYS taught by Dr.Angdi.
 *
 * Scheduling:
 *  - Theory = 3 separate one-hour sessions/week.
 *  - Tutorial = 1 one-hour session/week.
 *  - Lab = 2 consecutive hours per batch/week.
 *  - Labs never cross 12:00-14:00.
 *  - Same subject + division uses same faculty.
 *  - No faculty overlap.
 *  - No room overlap (online sessions use no physical room).
 *  - No division overlap.
 *  - Coursera 1, Coursera 2 and DT are online-capable and are used to
 *    close suitable gaps after the core physical timetable is placed.
 */

export type SchedulerStudent = {
  division: string;
  registeredSubject: string;
};

export type SchedulerFaculty = {
  id: number;
  name: string;
  department: string | null;
  maxWeeklyHours: number;
};

export type SchedulerFacultyAssignment = {
  subjectCode: string;
  division: string;
  facultyId: number;
};

export type SchedulerDivisionHoliday = {
  division: string;
  day: string;
};

export type SchedulerLabBatch = {
  division: string;
  batchName: string;
  studentCount: number;
  subjectCode?: string | null;
};

export type SchedulerRoomAssignment = {
  division: string;
  roomId: number;
  classType: "Theory" | "Tutorial" | "Lab";
  subjectCode?: string | null;
  batchName?: string | null;
};

export type SchedulerFacultyAvailability = {
  facultyId: number;
  day: string;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
};

export type SchedulerSubject = {
  id: number;
  code: string;
  name: string;
  type: string | null;
  weeklyHours: number;
};

export type SchedulerClassroom = {
  id: number;
  roomNumber: string;
  roomType: string;
  capacity: number;
};

export type GeneratedSession = {
  day: string;
  time: string;
  subject: string;
  faculty: string;
  room: string;
  division: string;
  classType: "Theory" | "Tutorial" | "Lab";
  batch: string | null;
  batchSize: number | null;
  status: "draft";
};

export type GeneratedConflict = {
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  category: string;
};

export type SchedulerResult = {
  sessions: GeneratedSession[];
  conflicts: GeneratedConflict[];
};

// MLOPS is a choice course with a relatively small total cohort. Since the
// supplied data assigns Dr.Angdi to MLOPS and students from every division
// may choose it, separate 3-hour theory + lab schedules per division would
// require impossible faculty capacity. We therefore schedule one shared MLOPS
// cohort and expose that session to every registered student's division.
const SHARED_MLOPS_DIVISION = "__SHARED_MLOPS__";

/* -------------------------------------------------------------------------- */
/* BASIC CONFIGURATION                                                        */
/* -------------------------------------------------------------------------- */

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const PERIODS = [
  "8:00–9:00",
  "9:00–10:00",
  "10:00–11:00",
  "11:00–12:00",
  "12:00–1:00",
  "1:00–2:00",
  "2:00–3:00",
  "3:00–4:00",
  "4:00–5:00",
  "5:00–6:00",
];

const LUNCH_SLOTS = new Set([
  "12:00–1:00",
  "1:00–2:00",
]);

// These subjects are delivered online in this timetable model. They still
// consume a faculty hour and a division hour, but they do not consume a
// physical classroom. Scheduling them after the core subjects lets the
// generator use them to close otherwise awkward gaps in a student's day.
const ONLINE_SUBJECT_CODES = new Set([
  "COURSERA1",
  "COURSERA2",
  "DT",
]);

function isOnlineSubjectCode(code: string) {
  return ONLINE_SUBJECT_CODES.has(canonicalCode(code));
}

/* -------------------------------------------------------------------------- */
/* NORMALIZATION                                                              */
/* -------------------------------------------------------------------------- */

const norm = (value: string | null | undefined) =>
  (value ?? "").trim().toUpperCase();

const bookingKey = (day: string, time: string) =>
  `${day}|${time}`;

/**
 * Convert:
 * 8:00 AM
 * 8:00
 * 13:00
 * 1:00 PM
 * 2:00
 * 3:00
 *
 * into minutes from midnight.
 */
function minutes(value: string): number {
  const text = value.trim();

  const match = text.match(
    /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i,
  );

  if (!match) return -1;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ampm = match[3]?.toUpperCase();

  if (ampm === "PM" && hour !== 12) {
    hour += 12;
  }

  if (ampm === "AM" && hour === 12) {
    hour = 0;
  }

  /*
   * Faculty CSV data may contain:
   * 2:00
   * 3:00
   * 4:00
   *
   * These represent afternoon times.
   */
  if (!ampm && hour >= 1 && hour <= 7) {
    hour += 12;
  }

  return hour * 60 + minute;
}

function range(value: string) {
  const parts = value.split("–");

  return {
    start: minutes(parts[0] ?? ""),
    end: minutes(parts[1] ?? ""),
  };
}

function formatHour(totalMinutes: number) {
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;

  const hour12 = hour24 % 12 || 12;

  return `${hour12}:${String(minute).padStart(2, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* SUBJECT NORMALIZATION                                                      */
/* -------------------------------------------------------------------------- */

function classTypeOf(
  subject: SchedulerSubject,
): "Theory" | "Tutorial" | "Lab" {
  const code = canonicalCode(subject.code || subject.name);

  const type = norm(subject.type);

  /*
   * IMPORTANT:
   * MLOPS is NOT forced to Lab anymore.
   *
   * It can now have:
   * Theory
   * Lab
   */

  if (
    type === "LAB" ||
    type.includes("PRACTICAL") ||
    type.includes("PRACTICALS")
  ) {
    return "Lab";
  }

  if (type === "TUTORIAL") {
    return "Tutorial";
  }

  return "Theory";
}

function isLab(subject: SchedulerSubject) {
  return classTypeOf(subject) === "Lab";
}

function isTutorial(subject: SchedulerSubject) {
  return classTypeOf(subject) === "Tutorial";
}

/* -------------------------------------------------------------------------- */
/* CHOICE SUBJECT                                                             */
/* -------------------------------------------------------------------------- */

function canonicalChoice(value: string) {
  const v = norm(value).replace(/[^A-Z0-9]/g, "");

  if (
    v === "MLOPS" ||
    v === "ML3203B" ||
    v.includes("MACHINELEARNINGOPERATIONS")
  ) {
    return "MLOPS";
  }

  return "CN";
}

/* -------------------------------------------------------------------------- */
/* SUBJECT CODE NORMALIZATION                                                */
/* -------------------------------------------------------------------------- */

function canonicalCode(value: string) {
  const v = norm(value).replace(/[^A-Z0-9]/g, "");

  /*
   * MLOPS
   */
  if (
    v === "MLOPS" ||
    v === "ML3203B" ||
    v.includes("MACHINELEARNINGOPERATIONS")
  ) {
    return "MLOPS";
  }

  /*
   * DAA
   */
  if (
    v === "ML3201" ||
    v === "ML3002" ||
    v === "DAA" ||
    v.includes("DESIGNANDANALYSISOFALGORITHMS")
  ) {
    return "ML3002";
  }

  /*
   * Machine Learning
   */
  if (
    v === "ML3202" ||
    v === "ML3003" ||
    v.includes("MACHINELEARNING")
  ) {
    return "ML3003";
  }

  /*
   * Cloud Computing
   */
  if (
    v === "ML3203" ||
    v === "ML3004" ||
    v.includes("CLOUDCOMPUTING")
  ) {
    return "ML3004";
  }

  /*
   * Computer Networks
   */
  if (
    v === "CN" ||
    v === "CNT" ||
    v.includes("COMPUTERNETWORK")
  ) {
    return "CN";
  }

  if (v === "COURSERA1" || v.includes("COURSERAONE")) return "COURSERA1";
  if (v === "COURSERA2" || v.includes("COURSERATWO")) return "COURSERA2";
  if (v === "DT" || v === "DIGITALTRANSFORMATION" || v === "DESIGNTHINKING") return "DT";

  return norm(value);
}

/* -------------------------------------------------------------------------- */
/* DIVISION NORMALIZATION                                                     */
/* -------------------------------------------------------------------------- */

function canonicalDivision(value: string) {
  const v = norm(value)
    .replace(/_/g, "-")
    .replace(/\s+/g, " ");

  const ty = v.match(/^TY\s*-?\s*([A-Z])$/);

  if (ty) {
    return `TY-${ty[1]}`;
  }

  const aiml = v.match(/^AIML\s*-?\s*([A-Z])$/);

  if (aiml) {
    // AIML-B is part of TY-B for this project. Keep the student records
    // intact, but use one timetable division everywhere.
    if (aiml[1] === "B") {
      return "TY-B";
    }

    return `AIML-${aiml[1]}`;
  }

  return v;
}

/* -------------------------------------------------------------------------- */
/* BATCH CALCULATION                                                          */
/* -------------------------------------------------------------------------- */

function batchesFor(
  studentCount: number,
  capacity: number,
) {
  if (studentCount <= 0 || capacity <= 0) {
    return [] as number[];
  }

  const batches: number[] = [];

  let remaining = studentCount;

  while (remaining > 0) {
    const current = Math.min(
      remaining,
      capacity,
    );

    batches.push(current);

    remaining -= current;
  }

  return batches;
}

/* -------------------------------------------------------------------------- */
/* FACULTY AVAILABILITY                                                       */
/* -------------------------------------------------------------------------- */

function availabilityCovers(
  rows: SchedulerFacultyAvailability[],
  facultyId: number,
  day: string,
  slot: string,
) {
  const matching = rows.filter(
    (row) =>
      row.facultyId === facultyId &&
      norm(row.day) === norm(day),
  );

  /*
   * If no availability was entered for that day,
   * treat the faculty as available.
   */
  if (!matching.length) {
    return true;
  }

  const target = range(slot);

  return matching.some((row) => {
    if (!row.isAvailable) {
      return false;
    }

    const start = minutes(row.startTime);
    const end = minutes(row.endTime);

    if (start < 0 || end < 0) {
      return false;
    }

    return (
      target.start >= start &&
      target.end <= end
    );
  });
}

/* -------------------------------------------------------------------------- */
/* FACULTY HOLIDAY                                                            */
/* -------------------------------------------------------------------------- */

function facultyHolidayMap(
  faculty: SchedulerFaculty[],
  availability: SchedulerFacultyAvailability[],
) {
  const result = new Map<number, string>();

  for (const person of faculty) {
    const off = availability.find(
      (row) =>
        row.facultyId === person.id &&
        !row.isAvailable,
    );

    if (off) {
      result.set(person.id, off.day);
    } else {
      const angdiPerson = norm(person.name).replace(/\s+/g, "").includes("ANGDI");
      result.set(
        person.id,
        angdiPerson ? "Saturday" : (person.id % 2 === 0 ? "Saturday" : "Monday"),
      );
    }
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* DIVISION HOLIDAY                                                           */
/* -------------------------------------------------------------------------- */

function divisionHolidayMap(
  divisions: string[],
  configured: SchedulerDivisionHoliday[],
) {
  const result = new Map<string, string>();
  const configuredMap = new Map<string, string>();

  for (const item of configured) {
    const division = canonicalDivision(item.division);
    const day = item.day.trim().replace(/\s+/g, " ");
    if (DAYS.includes(day)) configuredMap.set(division, day);
  }

  divisions.forEach((division, index) => {
    result.set(
      division,
      configuredMap.get(division) ??
        (index % 2 === 0 ? "Monday" : "Saturday"),
    );
  });

  return result;
}

/* -------------------------------------------------------------------------- */
/* MAIN SCHEDULER                                                             */
/* -------------------------------------------------------------------------- */

function runScheduleAttempt(input: {
  students: SchedulerStudent[];
  faculty: SchedulerFaculty[];
  facultyAvailability?: SchedulerFacultyAvailability[];
  facultyAssignments?: SchedulerFacultyAssignment[];
  divisionHolidays?: SchedulerDivisionHoliday[];
  labBatches?: SchedulerLabBatch[];
  roomAssignments?: SchedulerRoomAssignment[];
  subjects: SchedulerSubject[];
  classrooms: SchedulerClassroom[];
  onlyDivisions?: string[];
  reservedSessions?: GeneratedSession[];
  /**
   * Internal only: perturbs the order divisions are processed in.
   * The greedy scheduler's outcome for a handful of edge-case divisions
   * genuinely depends on processing order once the week is close to fully
   * booked (see `generateTimetable` below) - seed 0 is the original,
   * deterministic "largest division first" order.
   */
  divisionSeed?: number;
}): SchedulerResult {
  const facultyAvailability =
    input.facultyAvailability ?? [];

  const facultyAssignments =
    input.facultyAssignments ?? [];

  const divisionHolidays =
    input.divisionHolidays ?? [];

  const labBatches = input.labBatches ?? [];
  const roomAssignments = input.roomAssignments ?? [];

  const reservedSessions =
    input.reservedSessions ?? [];

  const conflicts: GeneratedConflict[] = [];

  const sessions: GeneratedSession[] = [];

  /* ---------------------------------------------------------------------- */
  /* BASIC VALIDATION                                                       */
  /* ---------------------------------------------------------------------- */

  if (!input.faculty.length) {
    return {
      sessions,
      conflicts: [
        {
          severity: "high",
          title: "No faculty on file",
          detail:
            "Add faculty before generating the timetable.",
          category: "Setup",
        },
      ],
    };
  }

  if (!input.classrooms.length) {
    return {
      sessions,
      conflicts: [
        {
          severity: "high",
          title: "No classrooms on file",
          detail:
            "Add classrooms before generating the timetable.",
          category: "Setup",
        },
      ],
    };
  }

  /* ---------------------------------------------------------------------- */
  /* NORMALIZE STUDENTS                                                     */
  /* ---------------------------------------------------------------------- */

  const students = input.students.map(
    (student) => ({
      ...student,
      division: canonicalDivision(
        student.division,
      ),
      registeredSubject:
        canonicalChoice(
          student.registeredSubject,
        ),
    }),
  );

  let divisions = Array.from(
    new Set(
      students
        .map(
          (student) => student.division,
        )
        .filter(Boolean),
    ),
  ).sort((a, b) => {
    const ac = students.filter((student) => student.division === a).length;
    const bc = students.filter((student) => student.division === b).length;
    return bc - ac || a.localeCompare(b);
  });

  // Deterministically perturb division order for seeds > 0, using a
  // seeded Fisher-Yates shuffle so `generateTimetable`'s multi-attempt
  // wrapper gets real variety across the full space of division orderings
  // (not just a handful of rotations) while staying reproducible for a
  // given seed.
  const divisionSeed = input.divisionSeed ?? 0;
  if (divisionSeed > 0 && divisions.length > 1) {
    let state = divisionSeed * 2654435761 >>> 0;
    const nextRandom = () => {
      state = (state ^ (state << 13)) >>> 0;
      state = (state ^ (state >>> 17)) >>> 0;
      state = (state ^ (state << 5)) >>> 0;
      return state / 4294967296;
    };
    for (let i = divisions.length - 1; i > 0; i--) {
      const j = Math.floor(nextRandom() * (i + 1));
      [divisions[i], divisions[j]] = [divisions[j], divisions[i]];
    }
  }

  /* ---------------------------------------------------------------------- */
  /* PARTIAL GENERATION                                                     */
  /* ---------------------------------------------------------------------- */

  if (input.onlyDivisions?.length) {
    const wanted = new Set(
      input.onlyDivisions.map(
        canonicalDivision,
      ),
    );

    divisions = divisions.filter(
      (division) =>
        wanted.has(division),
    );

    if (!divisions.length) {
      return {
        sessions,
        conflicts: [
          {
            severity: "medium",
            title: "No matching division",
            detail:
              input.onlyDivisions.join(", "),
            category: "Setup",
          },
        ],
      };
    }
  }

  /* ---------------------------------------------------------------------- */
  /* HOLIDAYS                                                               */
  /* ---------------------------------------------------------------------- */

  const divisionHoliday =
    divisionHolidayMap(divisions, divisionHolidays);

  const facultyHoliday =
    facultyHolidayMap(
      input.faculty,
      facultyAvailability,
    );

  /* ---------------------------------------------------------------------- */
  /* RESOURCE BOOKING                                                       */
  /* ---------------------------------------------------------------------- */

  const facultyBooked =
    new Map<number, Set<string>>();

  const facultyHours =
    new Map<number, number>();

  const roomBooked =
    new Map<number, Set<string>>();

  const divisionBooked =
    new Map<string, Set<string>>();

  const choiceDivisionBooked =
    new Map<string, Set<string>>();

  const facultyLunch =
    new Map<string, string>();

  for (const person of input.faculty) {
    facultyBooked.set(
      person.id,
      new Set(),
    );

    facultyHours.set(
      person.id,
      0,
    );
  }

  for (const room of input.classrooms) {
    roomBooked.set(
      room.id,
      new Set(),
    );
  }

  for (const division of divisions) {
    divisionBooked.set(division, new Set());
    choiceDivisionBooked.set(`${division}|CN`, new Set());
    choiceDivisionBooked.set(`${division}|MLOPS`, new Set());
  }
  divisionBooked.set(SHARED_MLOPS_DIVISION, new Set());
  choiceDivisionBooked.set(`${SHARED_MLOPS_DIVISION}|MLOPS`, new Set());

  /* ---------------------------------------------------------------------- */
  /* RESERVE EXISTING SESSIONS                                              */
  /* ---------------------------------------------------------------------- */

  for (const reserved of reservedSessions) {
    const baseDivision =
      canonicalDivision(
        reserved.division
          .split(" · ")[0],
      );

    const facultyMember =
      input.faculty.find(
        (person) =>
          norm(person.name) ===
          norm(reserved.faculty),
      );

    const room =
      input.classrooms.find(
        (item) =>
          norm(item.roomNumber) ===
          norm(reserved.room),
      );

    const timeRange =
      range(reserved.time);

    if (
      facultyMember &&
      timeRange.start >= 0 &&
      timeRange.end > timeRange.start
    ) {
      for (
        let t = timeRange.start;
        t < timeRange.end;
        t += 60
      ) {
        const slot =
          `${formatHour(t)}–${formatHour(
            t + 60,
          )}`;

        facultyBooked
          .get(facultyMember.id)!
          .add(
            bookingKey(
              reserved.day,
              slot,
            ),
          );
      }
    }

    if (
      room &&
      timeRange.start >= 0 &&
      timeRange.end > timeRange.start
    ) {
      for (
        let t = timeRange.start;
        t < timeRange.end;
        t += 60
      ) {
        const slot =
          `${formatHour(t)}–${formatHour(
            t + 60,
          )}`;

        roomBooked
          .get(room.id)!
          .add(
            bookingKey(
              reserved.day,
              slot,
            ),
          );
      }
    }

    const reservedCode = canonicalCode(reserved.subject.split(" · ")[0]);
    const reservedDivisionSet = divisionBooked.get(baseDivision);

    if (reservedDivisionSet && timeRange.start >= 0 && timeRange.end > timeRange.start) {
      for (let t = timeRange.start; t < timeRange.end; t += 60) {
        const slot = `${formatHour(t)}–${formatHour(t + 60)}`;
        reservedDivisionSet.add(bookingKey(reserved.day, slot));
      }
    }

    if (reserved.division === SHARED_MLOPS_DIVISION && timeRange.start >= 0 && timeRange.end > timeRange.start) {
      for (let t = timeRange.start; t < timeRange.end; t += 60) {
        const slot = `${formatHour(t)}–${formatHour(t + 60)}`;
        for (const d of divisions) {
          divisionBooked.get(d)?.add(bookingKey(reserved.day, slot));
          choiceDivisionBooked.get(`${d}|MLOPS`)?.add(bookingKey(reserved.day, slot));
        }
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* SUBJECT CATALOG                                                        */
  /* ---------------------------------------------------------------------- */

  const subjectRows =
    new Map<string, SchedulerSubject[]>();

  for (const subject of input.subjects) {
    const code =
      canonicalCode(
        subject.code ||
          subject.name,
      );

    if (!subjectRows.has(code)) {
      subjectRows.set(
        code,
        [],
      );
    }

    subjectRows
      .get(code)!
      .push({
        ...subject,
        code,
      });
  }

  /* ---------------------------------------------------------------------- */
  /* REMOVE DUPLICATE SUBJECT COMPONENTS                                    */
  /* ---------------------------------------------------------------------- */

  for (const [code, rows] of subjectRows) {
    const unique =
      new Map<
        string,
        SchedulerSubject
      >();

    for (const row of rows) {
      const type =
        classTypeOf(row);

      const existing =
        unique.get(type);

      if (
        !existing ||
        row.id > existing.id
      ) {
        unique.set(
          type,
          {
            ...row,
            code,
            type,
          },
        );
      }
    }

    subjectRows.set(
      code,
      [...unique.values()],
    );
  }

  /* ---------------------------------------------------------------------- */
  /* SUBJECT GROUPS                                                         */
  /* ---------------------------------------------------------------------- */

  /*
   * Common subjects:
   *
   * DAA
   * Machine Learning
   * Cloud Computing
   */
  // Order matters for a breadth-first schedule. DAA and Machine Learning
  // require multiple lab batches; Cloud Computing is lecture/tutorial-only.
  // The restart search rotates all three priorities so one ordering does not
  // reserve the same rooms and periods on every attempt.
  // Rotate the three largest shared subjects through all meaningful priority
  // orders. Restricting retries to only DAA/ML swaps made the same divisions
  // repeatedly compete for the same lab and lecture openings.
  const commonSubjectOrders = [
    ["ML3004", "ML3002", "ML3003"],
    ["ML3002", "ML3003", "ML3004"],
    ["ML3003", "ML3004", "ML3002"],
    ["ML3003", "ML3002", "ML3004"],
    ["ML3002", "ML3004", "ML3003"],
    ["ML3004", "ML3003", "ML3002"],
  ];
  const commonCodes = [
    ...commonSubjectOrders[(input.divisionSeed ?? 0) % commonSubjectOrders.length],
    "COURSERA1",
    "COURSERA2",
    "DT",
  ];

  const cnSubjects =
    subjectRows.get("CN") ?? [];

  const mlopsSubjects =
    subjectRows.get("MLOPS") ?? [];

  /* ---------------------------------------------------------------------- */
  /* FIND DR.ANGDI                                                          */
  /* ---------------------------------------------------------------------- */

  const angdi =
    input.faculty.find(
      (person) => {
        const name =
          norm(person.name)
            .replace(/\s+/g, "");

        return (
          name.includes("DR.ANGDI") ||
          name.includes("DRANGDI") ||
          name.includes("ANGDI")
        );
      },
    );

  /* ---------------------------------------------------------------------- */
  /* SUBJECT -> FACULTY                                                     */
  /* ---------------------------------------------------------------------- */

  const facultyForSubject =
    new Map<
      string,
      SchedulerFaculty
    >();

  /* ---------------------------------------------------------------------- */
  /* ADMIN MANUAL FACULTY ASSIGNMENTS                                      */
  /* ---------------------------------------------------------------------- */

  const manualFacultyAssignments =
    new Map<string, SchedulerFaculty>();

  for (const assignment of facultyAssignments) {
    const code = canonicalCode(assignment.subjectCode);
    const division = canonicalDivision(assignment.division);

    const person = input.faculty.find(
      (facultyMember) =>
        facultyMember.id === assignment.facultyId,
    );

    if (!person) {
      conflicts.push({
        severity: "medium",
        title: "Assigned faculty not found",
        detail:
          `Admin assigned faculty ID ${assignment.facultyId} to ${code} for ${division}, but that faculty member is not present in the faculty data.`,
        category: "Faculty",
      });
      continue;
    }

    manualFacultyAssignments.set(
      `${code}|${division}`,
      person,
    );
  }

  /* ---------------------------------------------------------------------- */
  /* MLOPS SATURDAY TRACKING                                                */
  /* ---------------------------------------------------------------------- */

  let mlopsSaturdayBlocksUsed = 0;

  /* ---------------------------------------------------------------------- */
  /* LUNCH                                                                  */
  /* ---------------------------------------------------------------------- */

  function lunchAllowed(
    person: SchedulerFaculty,
    day: string,
    slots: string[],
  ) {
    // Every faculty member, including Dr.Angdi, must retain one lunch hour.
    // If neither 12:00–1:00 nor 1:00–2:00 is available, the session is not
    // placed rather than silently violating the institutional rule.
    const lunchKey =
      `${person.id}|${day}`;

    const existing =
      facultyLunch.get(lunchKey);

    if (existing) {
      return !slots.includes(
        existing,
      );
    }

    const possibleLunches = [
      "12:00–1:00",
      "1:00–2:00",
    ];

    for (
      const lunch of possibleLunches
    ) {
      const booked =
        facultyBooked
          .get(person.id)!
          .has(
            bookingKey(
              day,
              lunch,
            ),
          );

      if (booked) {
        continue;
      }

      if (
        !availabilityCovers(
          facultyAvailability,
          person.id,
          day,
          lunch,
        )
      ) {
        continue;
      }

      /*
       * If this class itself occupies lunch,
       * try another lunch slot instead.
       */
      if (slots.includes(lunch)) {
        continue;
      }

      facultyLunch.set(
        lunchKey,
        lunch,
      );

      return true;
    }

    return false;
  }

  /* ---------------------------------------------------------------------- */
  /* FACULTY CANDIDATES                                                     */
  /* ---------------------------------------------------------------------- */

  function candidateFaculty(
    code: string,
    division: string,
    requiredHours: number,
  ) {
    /*
     * MLOPS:
     * Theory + Lab BOTH go to Dr.Angdi.
     *
     * This remains locked even if an Admin assignment exists.
     */
    if (code === "MLOPS") {
      if (!angdi) {
        return [] as SchedulerFaculty[];
      }

      return [angdi];
    }

    /*
     * ADMIN MANUAL ASSIGNMENT:
     * If Admin selected a faculty for this subject + division,
     * that faculty gets priority over automatic assignment.
     */
    const manual =
      manualFacultyAssignments.get(
        `${code}|${division}`,
      );

    if (manual) {
      return [manual];
    }

    const existing =
      facultyForSubject.get(
        `${code}|${division}`,
      );

    if (existing) {
      return [existing];
    }

    /*
     * Dr.Angdi is reserved for MLOPS.
     */
    return input.faculty
      .filter((person) => {
        const name =
          norm(person.name)
            .replace(/\s+/g, "");

        if (
          name.includes("ANGDI")
        ) {
          return false;
        }

        const used =
          facultyHours.get(
            person.id,
          ) ?? 0;

        const remaining =
          Math.max(
            0,
            person.maxWeeklyHours -
              used,
          );

        return (
          remaining >=
          requiredHours
        );
      })
      .sort((a, b) => {
        const ah =
          facultyHours.get(
            a.id,
          ) ?? 0;

        const bh =
          facultyHours.get(
            b.id,
          ) ?? 0;

        return (
          ah - bh ||
          a.id - b.id
        );
      });
  }

  /* ---------------------------------------------------------------------- */
  /* ROOM SELECTION                                                         */
  /* ---------------------------------------------------------------------- */

  function availableRoom(
    pool: SchedulerClassroom[],
    day: string,
    slots: string[],
    batchSize: number,
  ) {
    return pool
      .filter(
        (room) =>
          room.capacity >=
          batchSize,
      )
      .sort(
        (a, b) =>
          a.capacity -
          b.capacity,
      )
      .find((room) =>
        slots.every(
          (slot) =>
            !roomBooked
              .get(room.id)!
              .has(
                bookingKey(
                  day,
                  slot,
                ),
              ),
        ),
      );
  }

  /* ---------------------------------------------------------------------- */
  /* STUDENT COMPACTNESS                                                    */
  /* ---------------------------------------------------------------------- */

  function gapExceedsTwoHours(slots: Set<number>) {
    if (slots.size <= 1) return false;

    // Lunch is a mandatory two-hour break and must never count as student
    // free time. Compress the timeline around 12:00–2:00 before measuring
    // gaps.
    const sorted = Array.from(slots)
      .sort((a, b) => a - b)
      .map((index) => (index >= 6 ? index - 2 : index));

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] - 1 > 2) return true;
    }

    return false;
  }

  function divisionWouldExceedTwoHourGap(
    division: string,
    day: string,
    proposedSlots: string[],
    subjectCode: string,
  ) {
    const buildOccupied = (choiceCode: "CN" | "MLOPS" | null) => {
      const occupied = new Set<number>();
      const common = divisionBooked.get(division) ?? new Set<string>();

      for (let i = 0; i < PERIODS.length; i++) {
        if (common.has(bookingKey(day, PERIODS[i]))) occupied.add(i);
      }

      if (choiceCode) {
        const choice = choiceDivisionBooked.get(`${division}|${choiceCode}`) ?? new Set<string>();
        for (let i = 0; i < PERIODS.length; i++) {
          if (choice.has(bookingKey(day, PERIODS[i]))) occupied.add(i);
        }
      }

      for (const slot of proposedSlots) {
        const index = PERIODS.indexOf(slot);
        if (index >= 0) occupied.add(index);
      }

      return occupied;
    };

    if (division === SHARED_MLOPS_DIVISION) {
      // Shared MLOPS students belong to the real divisions, so their MLOPS
      // session must remain compact relative to each division's common
      // timetable.
      return divisions.some((d) => {
        const hasMlops = students.some(
          (student) => student.division === d && student.registeredSubject === "MLOPS",
        );
        return hasMlops && gapExceedsTwoHours(buildOccupiedForDivision(d, day, proposedSlots, "MLOPS"));
      });
    }

    const code = canonicalCode(subjectCode);

    if (code === "CN") {
      return gapExceedsTwoHours(buildOccupied("CN"));
    }

    if (code === "MLOPS") {
      return gapExceedsTwoHours(buildOccupied("MLOPS"));
    }

    // Common subjects are attended by both choice cohorts. Check each
    // cohort separately so neither CN nor MLOPS students get a long gap.
    const hasCN = students.some(
      (student) => student.division === division && student.registeredSubject === "CN",
    );
    const hasMLOPS = students.some(
      (student) => student.division === division && student.registeredSubject === "MLOPS",
    );

    if (hasCN && gapExceedsTwoHours(buildOccupied("CN"))) return true;
    if (hasMLOPS && gapExceedsTwoHours(buildOccupied("MLOPS"))) return true;
    return false;
  }

  function buildOccupiedForDivision(
    division: string,
    day: string,
    proposedSlots: string[],
    choiceCode: "CN" | "MLOPS",
  ) {
    const occupied = new Set<number>();
    const common = divisionBooked.get(division) ?? new Set<string>();
    const choice = choiceDivisionBooked.get(`${division}|${choiceCode}`) ?? new Set<string>();

    for (let i = 0; i < PERIODS.length; i++) {
      if (common.has(bookingKey(day, PERIODS[i])) || choice.has(bookingKey(day, PERIODS[i]))) occupied.add(i);
    }
    for (const slot of proposedSlots) {
      const index = PERIODS.indexOf(slot);
      if (index >= 0) occupied.add(index);
    }
    return occupied;
  }

  function gapStats(slots: Set<number>) {
    if (slots.size <= 1) {
      return { maxGap: 0, totalGap: 0 };
    }

    // Ignore the protected two-hour lunch break when measuring a student's
    // internal free time. Everything else between the first and last class
    // is a genuine timetable gap.
    const sorted = Array.from(slots)
      .sort((a, b) => a - b)
      .map((index) => (index >= 6 ? index - 2 : index));

    let maxGap = 0;
    let totalGap = 0;
    for (let i = 1; i < sorted.length; i++) {
      const gap = Math.max(0, sorted[i] - sorted[i - 1] - 1);
      maxGap = Math.max(maxGap, gap);
      totalGap += gap;
    }

    return { maxGap, totalGap };
  }

  function candidateGapPenalty(occupiedIndexes: Set<number>, proposedSlots: string[]) {
    const occupied = new Set(occupiedIndexes);
    for (const slot of proposedSlots) {
      const index = PERIODS.indexOf(slot);
      if (index >= 0) occupied.add(index);
    }
    const stats = gapStats(occupied);
    return stats.maxGap * 100 + stats.totalGap;
  }

  /* ---------------------------------------------------------------------- */
  /* PLACE SESSION                                                          */
  /* ---------------------------------------------------------------------- */

  function configuredBatchesFor(division: string, subjectCode: string, fallbackCount: number, fallbackCapacity: number) {
    const code = canonicalCode(subjectCode);
    const base = canonicalDivision(division);
    const configured = labBatches
      .filter((item) => canonicalDivision(item.division) === base)
      .filter((item) => {
        const configuredCode = canonicalCode(item.subjectCode ?? "");
        return !configuredCode || configuredCode === code;
      })
      .sort((a, b) => a.batchName.localeCompare(b.batchName));

    if (!configured.length) {
      return batchesFor(fallbackCount, fallbackCapacity).map((studentCount, index) => ({
        batchName: `Batch ${String.fromCharCode(65 + index)}`,
        studentCount,
      }));
    }
    return configured.map((item) => ({
      batchName: item.batchName,
      studentCount: Math.max(1, Number(item.studentCount) || 1),
    }));
  }

  function assignedRoomIdsFor(division: string, classType: "Theory" | "Tutorial" | "Lab", subjectCode: string, batchName: string | null) {
    const base = canonicalDivision(division);
    const code = canonicalCode(subjectCode);
    const matches = roomAssignments.filter((item) => {
      if (canonicalDivision(item.division) !== base) return false;
      if (item.classType !== classType) return false;
      if (item.subjectCode && canonicalCode(item.subjectCode) !== code) return false;
      if (item.batchName && item.batchName !== batchName) return false;
      return true;
    });
    return matches.map((item) => item.roomId);
  }

  function placeWithFaculty(
    subject: SchedulerSubject,
    division: string,
    label: string,
    batch: string | null,
    batchSize: number,
    person: SchedulerFaculty,
    requireNewSubjectDay: boolean,
    usedSubjectDays: Set<string>,
    allowGap: boolean = false,
  ) {
    const classType =
      classTypeOf(subject);

    const duration =
      classType === "Lab"
        ? 2
        : 1;

    /* ------------------------------------------------------------------ */
    /* ROOM TYPE                                                           */
    /* ------------------------------------------------------------------ */

    const online = isOnlineSubjectCode(subject.code);
    const assignedRoomIds = assignedRoomIdsFor(division, classType, subject.code, batch);
    const roomPool =
      online
        ? []
        : (assignedRoomIds.length
          ? input.classrooms.filter((room) => assignedRoomIds.includes(room.id))
          : classType === "Lab"
            ? input.classrooms.filter((room) => norm(room.roomType).includes("LAB"))
            : input.classrooms.filter((room) => !norm(room.roomType).includes("LAB")));

    if (!online && !roomPool.length) {
      return false;
    }

    /* ------------------------------------------------------------------ */
    /* DAY ORDER                                                            */
    /* ------------------------------------------------------------------ */

    const orderedDays =
      DAYS
        .map((day, index) => ({
          day,
          index,
          load:
            Array.from(
              divisionBooked
                .get(division) ??
                [],
            ).filter((key) =>
              key.startsWith(
                `${day}|`,
              ),
            ).length,
        }))
        .sort(
          (a, b) =>
            b.load -
              a.load ||
            a.index -
              b.index,
        )
        .map(
          (item) =>
            item.day,
        );

    for (const day of orderedDays) {
      /*
       * Division holiday.
       */
      if (
        divisionHoliday.get(
          division,
        ) === day
      ) {
        continue;
      }

      // A shared MLOPS class serves students from every division, so it may
      // only run on a day when every participating division is teaching.
      if (
        division === SHARED_MLOPS_DIVISION &&
        divisions.some((d) => divisionHoliday.get(d) === day)
      ) {
        continue;
      }

      /*
       * Faculty holiday.
       */
      if (
        facultyHoliday.get(
          person.id,
        ) === day
      ) {
        continue;
      }

      /*
       * Same subject theory sessions
       * must be on different days.
       */
      if (
        requireNewSubjectDay &&
        usedSubjectDays.has(day)
      ) {
        continue;
      }

      /* -------------------------------------------------------------- */
      /* TIME SLOTS                                                       */
      /* -------------------------------------------------------------- */

      const occupiedIndexes = new Set<number>();
      const code = canonicalCode(subject.code);
      const effective = new Set<string>(divisionBooked.get(division) ?? []);
      if (code === "CN" || code === "MLOPS") {
        for (const slot of choiceDivisionBooked.get(`${division}|${code}`) ?? []) effective.add(slot);
      } else {
        for (const choiceCode of ["CN", "MLOPS"]) {
          for (const slot of choiceDivisionBooked.get(`${division}|${choiceCode}`) ?? []) effective.add(slot);
        }
      }
      for (let i = 0; i < PERIODS.length; i++) {
        if (effective.has(bookingKey(day, PERIODS[i]))) occupiedIndexes.add(i);
      }
      const slotIndexes = Array.from({ length: PERIODS.length }, (_, i) => i).sort((a, b) => {
        const slotsFor = (index: number) =>
          duration === 2
            ? [PERIODS[index], PERIODS[index + 1]].filter(Boolean)
            : [PERIODS[index]];

        const gapPenalty = (index: number) => {
          const proposed = slotsFor(index);
          if (proposed.length !== duration || proposed.some((slot) => LUNCH_SLOTS.has(slot))) {
            return Number.MAX_SAFE_INTEGER;
          }
          return candidateGapPenalty(occupiedIndexes, proposed);
        };

        const distance = (index: number) => {
          if (!occupiedIndexes.size) return 100;
          let best = 100;
          for (const occupied of occupiedIndexes) best = Math.min(best, Math.abs(index - occupied));
          return best;
        };

        // First minimize genuine whole-day student gaps. This is especially
        // important for the online Coursera/DT sessions: they can occupy an
        // otherwise empty hour without needing a physical classroom. Room
        // availability remains the next tie-breaker for physical classes.
        const roomsFreeAt = (index: number) => {
          if (online) return 1;
          const slots = slotsFor(index);
          const keySlots = slots.map((slot) => bookingKey(day, slot));
          return roomPool.filter((room) => keySlots.every((key) => !roomBooked.get(room.id)!.has(key))).length;
        };
        return (
          gapPenalty(a) - gapPenalty(b) ||
          distance(a) - distance(b) ||
          roomsFreeAt(b) - roomsFreeAt(a) ||
          a - b
        );
      });

      for (const index of slotIndexes) {
        const first =
          PERIODS[index];

        let slots: string[];

        if (duration === 1) {
          slots = [first];
        } else {
          if (
            index >=
            PERIODS.length - 1
          ) {
            continue;
          }

          slots = [
            PERIODS[index],
            PERIODS[index + 1],
          ];
        }

        /* ------------------------------------------------------------ */
        /* LUNCH CHECK (ALL CLASS TYPES)                                 */
        /*                                                               */
        /* 12:00-1:00 and 1:00-2:00 are BOTH a protected break for every */
        /* class type - Theory and Tutorial included, not only Lab. This */
        /* is separate from `lunchAllowed` below, which additionally     */
        /* guarantees the *faculty member* keeps a free hour somewhere   */
        /* in that window across their whole day.                       */
        /* ------------------------------------------------------------ */

        if (
          slots.some((slot) =>
            LUNCH_SLOTS.has(slot),
          )
        ) {
          continue;
        }

        /* ------------------------------------------------------------ */
        /* DIVISION OVERLAP                                              */
        /* ------------------------------------------------------------ */

        const subjectCode = canonicalCode(subject.code);
        const divisionConflict = slots.some((slot) => {
          const key = bookingKey(day, slot);
          if (divisionBooked.get(division)!.has(key)) return true;
          if (subjectCode === "CN" || subjectCode === "MLOPS") {
            return choiceDivisionBooked.get(`${division}|${subjectCode}`)!.has(key);
          }
          return ["CN", "MLOPS"].some((choiceCode) => choiceDivisionBooked.get(`${division}|${choiceCode}`)!.has(key));
        });
        if (divisionConflict) continue;

        /* ------------------------------------------------------------ */
        /* STUDENT COMPACTNESS                                           */
        /* ------------------------------------------------------------ */

        // Never create more than two empty hourly periods between classes
        // for the same division on the same day. This keeps student days
        // compact without allowing sessions to overlap. Per the spec's own
        // priority order, compactness is the LOWEST-priority rule — below
        // "all weekly requirements satisfied" — so callers may pass
        // allowGap=true on a relaxed retry pass rather than leave a subject
        // completely unscheduled just to preserve compactness.
        if (!allowGap) {
          if (division === SHARED_MLOPS_DIVISION) {
            if (divisions.some((d) => divisionWouldExceedTwoHourGap(d, day, slots, subject.code))) continue;
          } else if (divisionWouldExceedTwoHourGap(division, day, slots, subject.code)) {
            continue;
          }
        }

        /* ------------------------------------------------------------ */
        /* FACULTY OVERLAP                                               */
        /* ------------------------------------------------------------ */

        if (
          slots.some((slot) =>
            facultyBooked
              .get(person.id)!
              .has(
                bookingKey(
                  day,
                  slot,
                ),
              ),
          )
        ) {
          continue;
        }

        /* ------------------------------------------------------------ */
        /* FACULTY AVAILABILITY                                         */
        /* ------------------------------------------------------------ */

        if (
          slots.some(
            (slot) =>
              !availabilityCovers(
                facultyAvailability,
                person.id,
                day,
                slot,
              ),
          )
        ) {
          continue;
        }

        /* ------------------------------------------------------------ */
        /* LUNCH                                                         */
        /* ------------------------------------------------------------ */

        if (
          !lunchAllowed(
            person,
            day,
            slots,
          )
        ) {
          continue;
        }

        /* ------------------------------------------------------------ */
        /* ROOM                                                          */
        /* ------------------------------------------------------------ */

        const room = online
          ? null
          : availableRoom(
              roomPool,
              day,
              slots,
              batchSize,
            );

        if (!online && !room) {
          continue;
        }

        /* ------------------------------------------------------------ */
        /* BOOK RESOURCES                                                */
        /* ------------------------------------------------------------ */

        for (const slot of slots) {
          facultyBooked
            .get(person.id)!
            .add(
              bookingKey(
                day,
                slot,
              ),
            );

          const bookingCode = canonicalCode(subject.code);
          // A choice subject (CN/MLOPS) only occupies the subset of the
          // division's students who chose it - the other choice subject's
          // students are free at the same time, and the final validator
          // explicitly allows CN and MLOPS sessions to overlap for this
          // reason (see `allowedChoicePair` below). So choice sessions must
          // NOT mark the whole-division `divisionBooked` set (that would
          // needlessly stop CN and MLOPS running simultaneously and starve
          // the week of slots) - only their own choice-specific booking.
          // Common (non-choice) subjects still mark divisionBooked directly
          // because they apply to every student in the division, including
          // whichever choice subject each one takes.
          if (bookingCode === "CN" || bookingCode === "MLOPS") {
            choiceDivisionBooked.get(`${division}|${bookingCode}`)!.add(bookingKey(day, slot));
          } else {
            divisionBooked.get(division)!.add(bookingKey(day, slot));
          }
          if (division === SHARED_MLOPS_DIVISION && bookingCode === "MLOPS") {
            for (const d of divisions) {
              choiceDivisionBooked.get(`${d}|MLOPS`)!.add(bookingKey(day, slot));
            }
          }

          if (room) {
            roomBooked
              .get(room.id)!
              .add(
                bookingKey(
                  day,
                  slot,
                ),
              );
          }
        }

        facultyHours.set(
          person.id,
          (facultyHours.get(
            person.id,
          ) ?? 0) +
            slots.length,
        );

        if (
          canonicalCode(
            subject.code,
          ) === "MLOPS" &&
          day === "Saturday"
        ) {
          mlopsSaturdayBlocksUsed +=
            1;
        }

        if (
          requireNewSubjectDay
        ) {
          usedSubjectDays.add(day);
        }

        /* ------------------------------------------------------------ */
        /* SAVE SESSION                                                  */
        /* ------------------------------------------------------------ */

        sessions.push({
          day,
          time:
            `${slots[0].split("–")[0]}–${
              slots[
                slots.length - 1
              ].split("–")[1]
            }`,
          subject:
            `${subject.code} · ${subject.name}`,
          faculty:
            person.name,
          room:
            room?.roomNumber ?? "Online",
          division:
            label,
          classType,
          batch,
          batchSize:
            classType === "Lab"
              ? batchSize
              : null,
          status: "draft",
        });

        return true;
      }
    }

    return false;
  }

  /* ---------------------------------------------------------------------- */
  /* STATE SNAPSHOT                                                         */
  /* ---------------------------------------------------------------------- */

  function snapshot() {
    return {
      facultyBooked:
        new Map(
          [...facultyBooked].map(
            ([id, set]) => [
              id,
              new Set(set),
            ],
          ),
        ),

      facultyHours:
        new Map(
          facultyHours,
        ),

      roomBooked:
        new Map(
          [...roomBooked].map(
            ([id, set]) => [
              id,
              new Set(set),
            ],
          ),
        ),

      divisionBooked:
        new Map(
          [...divisionBooked].map(([id, set]) => [id, new Set(set)]),
        ),

      choiceDivisionBooked:
        new Map(
          [...choiceDivisionBooked].map(([id, set]) => [id, new Set(set)]),
        ),

      facultyLunch:
        new Map(
          facultyLunch,
        ),

      mlopsSaturdayBlocksUsed,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* ROLLBACK                                                               */
  /* ---------------------------------------------------------------------- */

  function rollback(
    fromSessionCount: number,
    state: ReturnType<
      typeof snapshot
    >,
  ) {
    sessions.splice(
      fromSessionCount,
    );

    for (
      const [id, set] of
      state.facultyBooked
    ) {
      facultyBooked.set(
        id,
        new Set(set),
      );
    }

    for (
      const [id, hours] of
      state.facultyHours
    ) {
      facultyHours.set(
        id,
        hours,
      );
    }

    for (
      const [id, set] of
      state.roomBooked
    ) {
      roomBooked.set(
        id,
        new Set(set),
      );
    }

    for (
      const [id, set] of
      state.divisionBooked
    ) {
      divisionBooked.set(
        id,
        new Set(set),
      );
    }

    for (const [id, set] of state.choiceDivisionBooked) {
      choiceDivisionBooked.set(id, new Set(set));
    }

    facultyLunch.clear();
    mlopsSaturdayBlocksUsed = state.mlopsSaturdayBlocksUsed;

    for (
      const [key, value] of
      state.facultyLunch
    ) {
      facultyLunch.set(
        key,
        value,
      );
    }
  }

  /* ---------------------------------------------------------------------- */
  /* SCHEDULE ONE SUBJECT FOR ONE DIVISION                                  */
  /* ---------------------------------------------------------------------- */

  function scheduleSubject(
    division: string,
    subjectRowsForCode: SchedulerSubject[],
  ) {
    if (
      !subjectRowsForCode.length
    ) {
      return;
    }

    const code =
      canonicalCode(
        subjectRowsForCode[0].code,
      );

    let theory:
      SchedulerSubject | undefined;

    let tutorial:
      SchedulerSubject | undefined;

    let lab:
      SchedulerSubject | undefined;

    /*
     * IMPORTANT:
     *
     * MLOPS now supports:
     * Theory + Lab
     *
     * It is no longer forced to Lab only.
     */
    theory =
      subjectRowsForCode.find(
        (row) =>
          classTypeOf(row) ===
          "Theory",
      );

    tutorial =
      subjectRowsForCode.find(
        (row) =>
          classTypeOf(row) ===
          "Tutorial",
      );

    lab =
      subjectRowsForCode.find(
        (row) =>
          classTypeOf(row) ===
          "Lab",
      );

    /*
     * Make sure MLOPS name/code are clean.
     */
    if (code === "MLOPS") {
      if (theory) {
        theory = {
          ...theory,
          code: "MLOPS",
          name:
            theory.name ||
            "Machine Learning Operations",
          type: "Theory",
          weeklyHours: 3,
        };
      }

      if (lab) {
        lab = {
          ...lab,
          code: "MLOPS",
          name:
            lab.name ||
            "Machine Learning Operations",
          type: "Lab",
          weeklyHours: 2,
        };
      }
    }

    /* ------------------------------------------------------------------ */
    /* STUDENT COUNT                                                       */
    /* ------------------------------------------------------------------ */

    const sharedMLOPS = code === "MLOPS" && division === SHARED_MLOPS_DIVISION;
    const studentsInDivision = sharedMLOPS
      ? students.filter((student) => student.registeredSubject === "MLOPS").length
      : students.filter(
          (student) =>
            student.division ===
            division,
        ).length;

    const choiceSubject = code === "CN" || code === "MLOPS";
    const studentsForSubject = sharedMLOPS
      ? students.filter((student) => student.registeredSubject === "MLOPS").length
      : choiceSubject
        ? students.filter((student) => student.division === division && student.registeredSubject === code).length
        : studentsInDivision;

    if (choiceSubject && studentsForSubject === 0) return;

    /* ------------------------------------------------------------------ */
    /* LAB CAPACITY                                                        */
    /* ------------------------------------------------------------------ */

    const labRooms =
      input.classrooms.filter(
        (room) =>
          norm(
            room.roomType,
          ).includes("LAB"),
      );

    const labCapacity =
      Math.max(
        0,
        ...labRooms.map(
          (room) =>
            room.capacity,
        ),
      );

    const batchPlan =
      lab
        ? configuredBatchesFor(
            division,
            code,
            studentsForSubject,
            labCapacity,
          )
        : [];
    const batchSizes = batchPlan.map((batch) => batch.studentCount);

    /* ------------------------------------------------------------------ */
    /* REQUIRED HOURS                                                     */
    /* ------------------------------------------------------------------ */

    /*
     * Theory = 3
     * Tutorial = 1
     * Lab = 2 × batches
     */
    const theoryHours = theory ? Math.max(1, theory.weeklyHours || 1) : 0;
    const tutorialHours = tutorial ? Math.max(1, tutorial.weeklyHours || 1) : 0;

    const requiredHours =
      theoryHours +
      tutorialHours +
      (lab
        ? 2 *
          batchSizes.length
        : 0);

    if (
      requiredHours === 0
    ) {
      return;
    }

    /* ------------------------------------------------------------------ */
    /* FACULTY CANDIDATES                                                 */
    /* ------------------------------------------------------------------ */

    const candidateCapacityHours = Math.max(
      theoryHours,
      tutorialHours,
      lab ? 2 : 0,
    );

    const candidates =
      candidateFaculty(
        code,
        division,
        candidateCapacityHours,
      );

    if (!candidates.length && code === "MLOPS") {
      conflicts.push({
        severity: "high",
        title: "Dr.Angdi unavailable",
        detail: `MLOPS for ${division} requires Dr.Angdi, but Dr.Angdi was not found or does not have enough remaining capacity.`,
        category: "Faculty",
      });
      return;
    }

    /* ------------------------------------------------------------------ */
    /* TRY FACULTY                                                        */
    /*                                                                    */
    /* Pass 1: strict, compact scheduling (max 2-hour student gap).       */
    /* Pass 2 (only if pass 1 fails for every candidate): same hard       */
    /* constraints, but the compactness preference is relaxed. Per the    */
    /* spec's stated priority order, "all weekly requirements satisfied"  */
    /* outranks "compact timetable / max 2-hour gap", so a subject must   */
    /* not be left unscheduled purely to preserve compactness when a      */
    /* conflict-free (if less compact) placement exists.                  */
    /* ------------------------------------------------------------------ */

    for (const allowGap of [false, true]) {
    for (
      const person of candidates
    ) {
      const before =
        sessions.length;

      const state =
        snapshot();

      const usedSubjectDays =
        new Set<string>();

      // Kept separate from usedSubjectDays (which tracks lab-batch days) so
      // that a theory session is free to land on the same day as this
      // subject's lab, matching the spec: only repeated THEORY sessions of
      // the same subject on the same day are disallowed.
      const usedTheoryDays =
        new Set<string>();

      let ok = true;

      /* -------------------------------------------------------------- */
      /* LAB FIRST                                                       */
      /* -------------------------------------------------------------- */

      if (lab) {
        for (
          let batchIndex = 0;
          batchIndex <
          batchSizes.length;
          batchIndex++
        ) {
          const batch = batchPlan[batchIndex]?.batchName ?? `Batch ${String.fromCharCode(65 + batchIndex)}`;

          const placed =
            placeWithFaculty(
              lab,
              division,
              `${division} · ${batch}`,
              batch,
              batchSizes[
                batchIndex
              ],
              person,
              batchIndex === 0,
              usedSubjectDays,
              allowGap,
            );

          if (!placed) {
            ok = false;
            break;
          }
        }
      }

      /* -------------------------------------------------------------- */
      /* THEORY                                                          */
      /* -------------------------------------------------------------- */

      if (
        ok &&
        theory
      ) {
        for (
          let i = 0;
          i < theoryHours;
          i++
        ) {
          const placed =
            placeWithFaculty(
              theory,
              division,
              division,
              null,
              studentsForSubject,
              person,
              // BUGFIX: this must be `true`. Theory has 3 weekly hours and the
              // hard rule is "same subject not more than once per day", i.e.
              // each of the 3 one-hour sessions must land on a different day.
              // This was hardcoded to `false`, which let the scheduler stack
              // all 3 theory hours (or 2 of them) on the same day whenever a
              // single day had open slots — the exact "repeated lecture of the
              // same subject on the same day" bug.
              true,
              usedTheoryDays,
              allowGap,
            );

          if (!placed) {
            ok = false;
            break;
          }
        }
      }

      /* -------------------------------------------------------------- */
      /* TUTORIAL                                                        */
      /* -------------------------------------------------------------- */

      if (
        ok &&
        tutorial
      ) {
        const placed =
          placeWithFaculty(
            tutorial,
            division,
            division,
            null,
            studentsInDivision,
            person,
            false,
            usedSubjectDays,
            allowGap,
          );

        if (!placed) {
          ok = false;
        }
      }

      /* -------------------------------------------------------------- */
      /* SUCCESS                                                         */
      /* -------------------------------------------------------------- */

      if (ok) {
        facultyForSubject.set(
          `${code}|${division}`,
          person,
        );

        return;
      }

      /* -------------------------------------------------------------- */
      /* FAILED -> ROLLBACK                                             */
      /* -------------------------------------------------------------- */

      rollback(
        before,
        state,
      );
    }
    }

    /* ------------------------------------------------------------------ */
    /* COMPONENT FACULTY FALLBACK                                         */
    /* ------------------------------------------------------------------ */

    // Faculty consistency is preferred, but it must not make an otherwise
    // valid subject impossible when one faculty member does not have enough
    // remaining weekly capacity for every component. In that edge case,
    // keep Theory/Lab/Tutorial conflict-free while allowing a different
    // faculty member per component. Manual assignments and MLOPS remain
    // locked to their explicitly selected faculty.
    if (
      code !== "MLOPS" &&
      !manualFacultyAssignments.has(`${code}|${division}`)
    ) {
      const before = sessions.length;
      const state = snapshot();
      let ok = true;

      const componentCandidates = (hours: number) =>
        candidateFaculty(code, division, hours);

      const usedSubjectDays = new Set<string>();
      const usedTheoryDays = new Set<string>();

      if (lab) {
        let placedLab = false;
        placedLab = true;
        for (let batchIndex = 0; batchIndex < batchSizes.length; batchIndex++) {
          const batch = batchPlan[batchIndex]?.batchName ?? `Batch ${String.fromCharCode(65 + batchIndex)}`;
          let placedBatch = false;
          // A single instructor may not have enough compatible openings for
          // every lab batch late in a dense schedule. Try instructors per
          // batch while retaining all of the scheduler's hard booking checks.
          for (const person of componentCandidates(2)) {
            const localBefore = sessions.length;
            const localState = snapshot();
            if (placeWithFaculty(
              lab,
              division,
              `${division} · ${batch}`,
              batch,
              batchSizes[batchIndex],
              person,
              batchIndex === 0,
              usedSubjectDays,
              true,
            )) {
              placedBatch = true;
              break;
            }
            rollback(localBefore, localState);
          }
          if (!placedBatch) {
            placedLab = false;
            break;
          }
        }
        if (!placedLab) ok = false;
      }

      if (ok && theory) {
        let placedTheory = false;
        placedTheory = true;
        for (let lecture = 0; lecture < theoryHours; lecture++) {
          let placedLecture = false;
          // Theory meetings must be on separate days, but the same faculty
          // member need not teach every meeting when availability is tight.
          for (const person of componentCandidates(1)) {
            const localBefore = sessions.length;
            const localState = snapshot();
            if (placeWithFaculty(
              theory,
              division,
              division,
              null,
              studentsForSubject,
              person,
              true,
              usedTheoryDays,
              true,
            )) {
              placedLecture = true;
              break;
            }
            rollback(localBefore, localState);
          }
          if (!placedLecture) {
            placedTheory = false;
            break;
          }
        }
        if (!placedTheory) ok = false;
      }

      if (ok && tutorial) {
        let placedTutorial = false;
        const tutorialFaculty = componentCandidates(tutorialHours);
        for (const person of tutorialFaculty) {
          const localBefore = sessions.length;
          const localState = snapshot();
          if (placeWithFaculty(
            tutorial,
            division,
            division,
            null,
            studentsInDivision,
            person,
            false,
            usedSubjectDays,
            true,
          )) {
            placedTutorial = true;
            break;
          }
          rollback(localBefore, localState);
        }
        if (!placedTutorial) ok = false;
      }

      if (ok) return;
      rollback(before, state);
    }

    /* ------------------------------------------------------------------ */
    /* COULD NOT FIT                                                      */
    /* ------------------------------------------------------------------ */

    conflicts.push({
      severity: "medium",
      title:
        `Unable to schedule ${code}`,
      detail:
        `${division} could not fit all ${requiredHours} required hours without violating faculty, room, division, holiday, lunch, availability or two-hour student-gap constraints.`,
      category:
        "Capacity",
    });
  }

  /* ---------------------------------------------------------------------- */
  /* MLOPS DIVISIONS FIRST                                                  */
  /* ---------------------------------------------------------------------- */

  /*
   * MLOPS is scheduled first because Dr.Angdi is fixed.
   */
  const mlopsSelectedStudents = students.filter((student) => student.registeredSubject === "MLOPS").length;

  if (mlopsSelectedStudents > 0) {
    if (!mlopsSubjects.length) {
      conflicts.push({
        severity: "high",
        title: "MLOPS subject missing",
        detail: "Students have selected MLOPS, but the MLOPS subject is not present in the subject catalog.",
        category: "Setup",
      });
    } else if (!angdi) {
      conflicts.push({
        severity: "high",
        title: "Dr.Angdi not found",
        detail: "MLOPS is fixed to Dr.Angdi, but Dr.Angdi is not present in the faculty data.",
        category: "Faculty",
      });
    } else {
      // One shared cohort keeps Dr.Angdi within his real availability while
      // every registered MLOPS student still receives the same timetable.
      scheduleSubject(SHARED_MLOPS_DIVISION, mlopsSubjects);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* COMMON SUBJECTS                                                        */
  /*                                                                        */
  /* Scheduled BREADTH-FIRST across divisions (one subject at a time, for   */
  /* every division, before moving to the next subject) rather than         */
  /* DEPTH-FIRST (finish one whole division before starting the next).      */
  /*                                                                        */
  /* With only 4 lecture rooms shared by every division, depth-first order  */
  /* let the first few divisions greedily claim the most convenient         */
  /* day/slot combinations for ALL of their subjects before later           */
  /* divisions got a single turn - starving those divisions even though     */
  /* the college-wide room supply had enough spare capacity elsewhere in    */
  /* the week. Breadth-first gives every division a fair, early turn at     */
  /* each subject in the recommended order (choice subjects/labs first,     */
  /* then theory-heavy commons, then the light 1-hour subjects last).       */
  /* ---------------------------------------------------------------------- */

  const hasCnByDivision = new Map<string, boolean>();
  for (const division of divisions) {
    hasCnByDivision.set(
      division,
      students.some((student) => student.division === division && student.registeredSubject === "CN"),
    );
  }

  /* Choice subject (CN) first: it carries multiple lab batches for large
   * divisions, so reserving its rooms/days early prevents late-generation
   * starvation. */
  for (const division of divisions) {
    if (hasCnByDivision.get(division)) {
      scheduleSubject(division, cnSubjects);
    }
  }

  /* DAA, Machine Learning, Cloud (theory + lab/tutorial heavy), then the
   * light 1-hour online-capable Coursera/DT subjects last, so they can
   * deliberately fill suitable gaps left by the core physical timetable. */
  for (const code of commonCodes) {
    for (const division of divisions) {
      scheduleSubject(
        division,
        subjectRows.get(code) ?? [],
      );
    }
  }

  /* ---------------------------------------------------------------------- */
  /* RETRY PASS FOR ANY DIVISION STILL MISSING REQUIRED HOURS               */
  /*                                                                        */
  /* Breadth-first ordering fixes most starvation, but a division can still */
  /* occasionally lose out on a specific subject if every faculty/room      */
  /* candidate it tried was already booked at the time. Re-attempt any      */
  /* subject that produced a "could not fit" conflict once more now that    */
  /* every division has had a full first pass and the week's booking map    */
  /* is more evenly spread out - this mirrors genuine backtracking rather   */
  /* than accepting the first failure as final.                            */
  /* ---------------------------------------------------------------------- */

  const firstPassConflicts = conflicts.filter((c) => c.category === "Capacity");
  if (firstPassConflicts.length) {
    // Remove exactly the "could not fit" conflicts wherever they sit in the
    // array (not just the tail), then re-attempt each one now that every
    // division has had a fair first pass and the week is more evenly booked.
    for (let i = conflicts.length - 1; i >= 0; i--) {
      if (conflicts[i].category === "Capacity") conflicts.splice(i, 1);
    }
    for (const failed of firstPassConflicts) {
      const match = failed.title.match(/^Unable to schedule (\S+)$/);
      const divisionMatch = failed.detail.match(/^(\S+) could not fit/);
      if (!match || !divisionMatch) {
        conflicts.push(failed);
        continue;
      }
      const code = match[1];
      const division = divisionMatch[1];
      scheduleSubject(division, subjectRows.get(code) ?? []);
      // If scheduleSubject succeeds this time it won't push a new conflict;
      // if it fails again it pushes a fresh "Capacity" conflict itself.
    }
  }

  /* ---------------------------------------------------------------------- */
  /* FINAL HARD VALIDATION                                                  */
  /* ---------------------------------------------------------------------- */

  const seen =
    new Map<
      string,
      GeneratedSession
    >();

  for (const session of sessions) {
    const timeRange =
      range(session.time);

    if (
      timeRange.start < 0 ||
      timeRange.end <=
        timeRange.start
    ) {
      conflicts.push({
        severity: "high",
        title:
          "Invalid timetable time",
        detail:
          `${session.subject} has an invalid time range: ${session.time}.`,
        category:
          "Conflict",
      });

      continue;
    }

    for (
      let t = timeRange.start;
      t < timeRange.end;
      t += 60
    ) {
      const slot =
        `${formatHour(t)}–${formatHour(
          t + 60,
        )}`;

      const resources = [
        `FACULTY:${norm(
          session.faculty,
        )}`,
      ];

      // "Online" is a virtual delivery mode, not a shared physical room.
      // Two divisions may therefore have different online lectures in the
      // same hour without creating a room collision. Faculty overlap is
      // still checked normally.
      if (norm(session.room) !== "ONLINE") {
        resources.push(`ROOM:${norm(session.room)}`);
      }

      for (
        const resource of resources
      ) {
        const key =
          `${resource}|${bookingKey(
            session.day,
            slot,
          )}`;

        if (seen.has(key)) {
          conflicts.push({
            severity: "high",
            title:
              "Overlap detected",
            detail:
              `${resource} is double-booked on ${session.day} at ${slot}.`,
            category:
              "Conflict",
          });
        } else {
          seen.set(
            key,
            session,
          );
        }
      }
    }

    /* ------------------------------------------------------------------ */
    /* DIVISION VALIDATION                                                  */
    /* ------------------------------------------------------------------ */

    const baseDivision = canonicalDivision(session.division.split(" · ")[0]);
    const currentRange = range(session.time);
    for (let t = currentRange.start; t < currentRange.end; t += 60) {
      const slot = `${formatHour(t)}–${formatHour(t + 60)}`;
      const sameDivision = sessions.filter((other) => {
        if (other === session || canonicalDivision(other.division.split(" · ")[0]) !== baseDivision || other.day !== session.day) return false;
        const otherRange = range(other.time);
        return otherRange.start <= t && t < otherRange.end;
      });
      for (const other of sameDivision) {
        const a = canonicalCode(session.subject.split(" · ")[0]);
        const b = canonicalCode(other.subject.split(" · ")[0]);
        const allowedChoicePair = (a === "CN" || a === "MLOPS") && (b === "CN" || b === "MLOPS") && a !== b;
        if (!allowedChoicePair) {
          const pair = [session.subject, other.subject, session.faculty, other.faculty].sort().join("|");
          const key = `DIVISION:${baseDivision}|${slot}|${pair}`;
          if (!seen.has(key)) {
            conflicts.push({ severity: "high", title: "Division overlap detected", detail: `${baseDivision} has overlapping sessions on ${session.day} at ${slot}.`, category: "Conflict" });
            seen.set(key, session);
          }
        }
      }
    }

    /* ------------------------------------------------------------------ */
    /* SUNDAY CHECK                                                        */
    /* ------------------------------------------------------------------ */

    if (
      norm(session.day) ===
      "SUNDAY"
    ) {
      conflicts.push({
        severity: "high",
        title:
          "Sunday class detected",
        detail:
          `${session.subject} was incorrectly scheduled on Sunday.`,
        category:
          "Holiday",
      });
    }

    /* ------------------------------------------------------------------ */
    /* LAB LUNCH CHECK                                                     */
    /* ------------------------------------------------------------------ */

    if (
      session.classType ===
        "Lab" &&
      range(session.time)
        .start >= 0
    ) {
      const slots: string[] = [];

      const r =
        range(session.time);

      for (
        let t = r.start;
        t < r.end;
        t += 60
      ) {
        slots.push(
          `${formatHour(t)}–${formatHour(
            t + 60,
          )}`,
        );
      }

      if (
        slots.some((slot) =>
          LUNCH_SLOTS.has(
            slot,
          ),
        )
      ) {
        conflicts.push({
          severity: "high",
          title:
            "Lab overlaps lunch",
          detail:
            `${session.subject} for ${session.division} overlaps the 12 PM-2 PM lunch period.`,
          category:
            "Lunch",
        });
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* RETURN                                                                 */
  /* ---------------------------------------------------------------------- */

  return {
    sessions,
    conflicts,
  };
}

/* ---------------------------------------------------------------------- */
/* MULTI-ATTEMPT WRAPPER                                                  */
/*                                                                        */
/* The greedy scheduler's success for a small number of edge-case         */
/* division/subject combinations depends on the order divisions are       */
/* processed in, once the week is close to fully booked (only 4 lecture   */
/* rooms and a shared cross-division MLOPS cohort make the schedule       */
/* genuinely tight for the larger divisions). Rather than accept whichever */
/* single ordering happens to run first, try a handful of deterministic   */
/* orderings and keep the one with the fewest hard-requirement conflicts, */
/* preferring more scheduled sessions on a tie. This is a real (if        */
/* simple) restart-based search, not a single greedy pass with no         */
/* fallback - per the brief's instruction to use "retry logic as          */
/* necessary" rather than leaving classes unscheduled after one attempt.  */
/* ---------------------------------------------------------------------- */

// Configurable via SCHEDULER_ATTEMPTS so an interactive "regenerate" click
// can stay fast while an offline/cron regeneration job can afford to spend
// more time searching for a fully conflict-free arrangement.
const SCHEDULE_ATTEMPTS = Number(process.env.SCHEDULER_ATTEMPTS) || 120;

function timetableGapScore(sessions: GeneratedSession[], students: SchedulerStudent[]) {
  const normalizedStudents = students.map((student) => ({
    division: canonicalDivision(student.division),
    choice: canonicalChoice(student.registeredSubject),
  }));

  let score = 0;
  const divisions = Array.from(new Set(normalizedStudents.map((s) => s.division).filter(Boolean)));

  for (const division of divisions) {
    const cohorts: Array<"CN" | "MLOPS"> = ["CN", "MLOPS"];
    for (const cohort of cohorts) {
      const hasCohort = normalizedStudents.some((s) => s.division === division && s.choice === cohort);
      if (!hasCohort) continue;

      for (const day of DAYS) {
        const indexes = new Set<number>();
        for (const session of sessions) {
          const baseDivision = canonicalDivision(session.division.split(" · ")[0]);
          const code = canonicalCode(session.subject.split(" · ")[0]);
          const common = baseDivision === division && !["CN", "MLOPS"].includes(code);
          const choice = baseDivision === division && code === cohort;
          const sharedMlops = code === "MLOPS" && session.division === SHARED_MLOPS_DIVISION;
          if (!common && !choice && !(sharedMlops && cohort === "MLOPS")) continue;
          if (session.day !== day) continue;
          const r = range(session.time);
          for (let t = r.start; t < r.end; t += 60) {
            const period = PERIODS.indexOf(`${formatHour(t)}–${formatHour(t + 60)}`);
            if (period >= 0) indexes.add(period);
          }
        }
        const stats = (() => {
          if (indexes.size <= 1) return { maxGap: 0, totalGap: 0 };
          const sorted = Array.from(indexes).sort((a, b) => a - b).map((i) => i >= 6 ? i - 2 : i);
          let maxGap = 0;
          let totalGap = 0;
          for (let i = 1; i < sorted.length; i++) {
            const gap = Math.max(0, sorted[i] - sorted[i - 1] - 1);
            maxGap = Math.max(maxGap, gap);
            totalGap += gap;
          }
          return { maxGap, totalGap };
        })();
        score += stats.maxGap * 100 + stats.totalGap;
      }
    }
  }

  return score;
}

export function generateTimetable(input: {
  students: SchedulerStudent[];
  faculty: SchedulerFaculty[];
  facultyAvailability?: SchedulerFacultyAvailability[];
  facultyAssignments?: SchedulerFacultyAssignment[];
  divisionHolidays?: SchedulerDivisionHoliday[];
  labBatches?: SchedulerLabBatch[];
  roomAssignments?: SchedulerRoomAssignment[];
  subjects: SchedulerSubject[];
  classrooms: SchedulerClassroom[];
  onlyDivisions?: string[];
  reservedSessions?: GeneratedSession[];
}): SchedulerResult {
  let best: SchedulerResult | null = null;

  for (let seed = 0; seed < SCHEDULE_ATTEMPTS; seed++) {
    const attempt = runScheduleAttempt({ ...input, divisionSeed: seed });

    if (!best) {
      best = attempt;
      continue;
    }

    // A "Setup" conflict (no faculty/classrooms/matching division at all)
    // is fatal and identical across every seed - no point trying more.
    if (attempt.conflicts.some((c) => c.category === "Setup")) {
      return attempt;
    }

    const attemptCapacityConflicts = attempt.conflicts.filter((c) => c.category === "Capacity").length;
    const bestCapacityConflicts = best.conflicts.filter((c) => c.category === "Capacity").length;

    const attemptGapScore = timetableGapScore(attempt.sessions, input.students);
    const bestGapScore = timetableGapScore(best.sessions, input.students);

    const better =
      attempt.conflicts.length < best.conflicts.length ||
      (attempt.conflicts.length === best.conflicts.length &&
        (attemptCapacityConflicts < bestCapacityConflicts ||
          (attemptCapacityConflicts === bestCapacityConflicts &&
            (attemptGapScore < bestGapScore ||
              (attemptGapScore === bestGapScore && attempt.sessions.length > best.sessions.length)))));

    if (better) best = attempt;

    // Perfect result - no need to keep searching.
    if (!best.conflicts.length) break;
  }

  return best!;
}
