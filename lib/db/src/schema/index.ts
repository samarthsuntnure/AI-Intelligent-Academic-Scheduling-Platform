import {
  mysqlTable,
  serial,
  varchar,
  int,
  uniqueIndex,
  mysqlEnum,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["admin", "faculty", "student"]).notNull(),
  name: varchar("name", { length: 255 }).notNull(),

  // Links a login to the matching record — null for admin accounts.
  facultyId: int("faculty_id"),
  studentId: int("student_id"),
});

export const students = mysqlTable("students", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  division: varchar("division", { length: 100 }).notNull(),
  rollNo: int("roll_no").notNull(),
  prn: varchar("prn", { length: 50 }),
  // Kept internally for backward-compatible imports; the UI never exposes it.
  registeredSubject: varchar("registered_subject", { length: 50 }).notNull().default("CN"),
  isActive: boolean("is_active").notNull().default(true),
});


export const divisions = mysqlTable("divisions", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  strength: int("strength").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

export const facultyAvailability = mysqlTable("faculty_availability", {
  id: serial("id").primaryKey(),
  facultyId: int("faculty_id").notNull(),
  day: varchar("day", { length: 20 }).notNull(),
  startTime: varchar("start_time", { length: 10 }).notNull(),
  endTime: varchar("end_time", { length: 10 }).notNull(),
  isAvailable: boolean("is_available").notNull().default(true),
});

export const faculty = mysqlTable("faculty", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  department: varchar("department", { length: 255 }),
  maxWeeklyHours: int("max_weekly_hours").notNull().default(18),
  isActive: boolean("is_active").notNull().default(true),
});

export const classrooms = mysqlTable("classrooms", {
  id: serial("id").primaryKey(),
  roomNumber: varchar("room_number", { length: 50 }).notNull().unique(),
  building: varchar("building", { length: 255 }),
  capacity: int("capacity").notNull().default(40),
  roomType: varchar("room_type", { length: 50 })
    .notNull()
    .default("lecture"),
  isActive: boolean("is_active").notNull().default(true),
});

export const subjects = mysqlTable(
  "subjects",
  {
    id: serial("id").primaryKey(),

    // Same code can exist for Theory, Lab and Tutorial.
    code: varchar("code", { length: 50 }).notNull(),

    name: varchar("name", { length: 255 }).notNull(),

    // Theory | Lab | Tutorial
    type: varchar("type", { length: 50 }),

    weeklyHours: int("weekly_hours").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => ({
    // Prevents duplicate combinations such as:
    // ML3203B + Theory
    // ML3203B + Lab
    // ML3203B + Tutorial
    //
    // But allows the same code with different types.
    codeTypeUnique: uniqueIndex("subjects_code_type_unique").on(
      table.code,
      table.type
    ),
  })
);

export const timetable = mysqlTable("timetable", {
  id: serial("id").primaryKey(),
  day: varchar("day", { length: 20 }).notNull(),
  time: varchar("time", { length: 50 }).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  faculty: varchar("faculty", { length: 255 }).notNull(),
  room: varchar("room", { length: 50 }).notNull(),
  division: varchar("division", { length: 100 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("draft"),
  classType: varchar("class_type", { length: 20 }).notNull().default("Theory"),
  batch: varchar("batch", { length: 50 }),
  batchSize: int("batch_size"),
});

export const conflicts = mysqlTable("conflicts", {
  id: serial("id").primaryKey(),
  severity: varchar("severity", { length: 20 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  detail: text("detail").notNull(),
  category: varchar("category", { length: 100 }).notNull(),
});

export const subjectFacultyAssignments = mysqlTable(
  "subject_faculty_assignments",
  {
    id: int("id").autoincrement().primaryKey(),
    subjectCode: varchar("subject_code", { length: 50 }).notNull(),
    division: varchar("division", { length: 50 }).notNull(),
    facultyId: int("faculty_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
);



export const labBatches = mysqlTable(
  "lab_batches",
  {
    id: int("id").autoincrement().primaryKey(),
    division: varchar("division", { length: 50 }).notNull(),
    batchName: varchar("batch_name", { length: 50 }).notNull(),
    studentCount: int("student_count").notNull(),
    subjectCode: varchar("subject_code", { length: 50 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    divisionBatchUnique: uniqueIndex("lab_batches_division_subject_batch_unique").on(
      table.division,
      table.subjectCode,
      table.batchName,
    ),
  }),
);

export const divisionRoomAssignments = mysqlTable(
  "division_room_assignments",
  {
    id: int("id").autoincrement().primaryKey(),
    division: varchar("division", { length: 50 }).notNull(),
    roomId: int("room_id").notNull(),
    classType: varchar("class_type", { length: 20 }).notNull(),
    subjectCode: varchar("subject_code", { length: 50 }),
    batchName: varchar("batch_name", { length: 50 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
);

export const divisionHolidays = mysqlTable(
  "division_holidays",
  {
    id: int("id").autoincrement().primaryKey(),
    division: varchar("division", { length: 50 }).notNull().unique(),
    day: varchar("day", { length: 20 }).notNull(),
  },
);
