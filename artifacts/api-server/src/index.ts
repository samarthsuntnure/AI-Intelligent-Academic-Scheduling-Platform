import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Minimal .env loader (no dotenv dependency): reads KEY=VALUE lines from
 * the repo root .env, and only sets values that aren't already present in
 * process.env, so real shell/OS env vars always win.
 *
 * This has to run — and finish — before "./app" (and anything it imports,
 * like the db connection) is evaluated, since that's what reads
 * DATABASE_URL. ES module `import` statements are hoisted and always run
 * before other top-level code, so app/db is imported dynamically below
 * instead of via a static `import` at the top of this file.
 */
function loadDotEnv(filePath: string) {
  if (!existsSync(filePath)) return;
  const contents = readFileSync(filePath, "utf-8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.resolve(import.meta.dirname, "..", "..", "..", ".env"));

// These small planning tables are additive. Create them automatically for
// existing local databases so upgrading this project never requires a reset.
const { pool } = await import("@workspace/db");
await pool.query(`CREATE TABLE IF NOT EXISTS divisions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  strength INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
)`);
const [divisionRows] = await pool.query(`SELECT division, COUNT(*) AS strength FROM students GROUP BY division`);
for (const row of divisionRows as any[]) {
  const raw = String(row.division || '').trim().toUpperCase().replace(/\s+/g, '');
  const match = raw.match(/^TY-?([A-Z])$/);
  const aiml = raw.match(/^AIML-?([A-Z])$/);
  const name = aiml ? (aiml[1] === 'B' ? 'TY-B' : `AIML-${aiml[1]}`) : (match ? `TY-${match[1]}` : String(row.division).trim());
  if (!name) continue;
  await pool.query(`INSERT INTO divisions (name, strength, is_active) VALUES (?, ?, TRUE) ON DUPLICATE KEY UPDATE strength = GREATEST(strength, VALUES(strength))`, [name, Number(row.strength) || 0]);
}

// MySQL 8.0 does not support `ADD COLUMN IF NOT EXISTS` for ALTER TABLE.
// Check INFORMATION_SCHEMA first so this startup migration remains safe and
// idempotent on both the original database and upgraded databases.
const ensureColumn = async (tableName: string, columnName: string, definition: string) => {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?`,
    [tableName, columnName],
  );

  const exists = Number((rows as any[])[0]?.count ?? 0) > 0;
  if (!exists) {
    await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
  }
};

await ensureColumn("students", "is_active", "BOOLEAN NOT NULL DEFAULT TRUE");
await ensureColumn("faculty", "is_active", "BOOLEAN NOT NULL DEFAULT TRUE");
await ensureColumn("classrooms", "is_active", "BOOLEAN NOT NULL DEFAULT TRUE");
await ensureColumn("subjects", "is_active", "BOOLEAN NOT NULL DEFAULT TRUE");

await pool.query(`
  CREATE TABLE IF NOT EXISTS lab_batches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    division VARCHAR(50) NOT NULL,
    batch_name VARCHAR(50) NOT NULL,
    student_count INT NOT NULL,
    subject_code VARCHAR(50) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY lab_batches_division_subject_batch_unique (division, subject_code, batch_name)
  )
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS division_room_assignments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    division VARCHAR(50) NOT NULL,
    room_id INT NOT NULL,
    class_type VARCHAR(20) NOT NULL,
    subject_code VARCHAR(50) NULL,
    batch_name VARCHAR(50) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

// Ensure a local admin account always exists after database initialization.
// This makes a fresh local database usable even if the CSV import has not yet
// been run. The import script uses the same credentials and can safely update
// the account on a reset.
const { default: bcrypt } = await import("bcryptjs");
const [adminRows] = await pool.query(`SELECT id FROM users WHERE email = ? LIMIT 1`, ["admin@vit.edu"]);
if (!(adminRows as any[]).length) {
  const passwordHash = await bcrypt.hash("Admin@123", 10);
  await pool.query(
    `INSERT INTO users (email, password_hash, role, name, faculty_id, student_id) VALUES (?, ?, 'admin', ?, NULL, NULL)`,
    ["admin@vit.edu", passwordHash, "Academic Office Admin"],
  );
}

const { default: app } = await import("./app");
const { logger } = await import("./lib/logger");

// API_PORT is preferred so it can't collide with the frontend's WEB_PORT
// if both happen to be read from the same shell/.env.
const rawPort = process.env["API_PORT"] ?? process.env["PORT"] ?? "5000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
