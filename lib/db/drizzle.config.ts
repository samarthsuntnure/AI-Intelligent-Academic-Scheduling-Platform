import { existsSync, readFileSync } from "fs";
import path from "path";
import { defineConfig } from "drizzle-kit";

/**
 * Minimal .env loader (no dotenv dependency): reads KEY=VALUE lines from
 * the repo root .env. drizzle-kit's CLI doesn't load .env files on its
 * own, so without this, `pnpm db:push` only works if DATABASE_URL is
 * already exported in your shell.
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

loadDotEnv(path.join(__dirname, "..", "..", ".env"));

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env in the project root and fill in your database connection.",
  );
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
