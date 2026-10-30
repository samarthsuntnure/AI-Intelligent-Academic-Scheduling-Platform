import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Minimal .env loader (no dotenv dependency). Import this FIRST in any
 * script that needs DATABASE_URL etc — e.g. `import "./env";` as the very
 * first line — so it runs before other imports (like "@workspace/db")
 * that read process.env as soon as they're loaded.
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

loadDotEnv(path.resolve(import.meta.dirname, "..", "..", ".env"));
