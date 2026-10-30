import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function findProjectRoot(start: string) {
  let current = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(current, "ml_engine", "engine.py"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(process.cwd());
}

export const ML_ROOT = process.env.PROJECT_ROOT ? path.resolve(process.env.PROJECT_ROOT) : findProjectRoot(import.meta.dirname);
export const ML_ENGINE = path.join(ML_ROOT, "ml_engine", "engine.py");
export const ML_UPLOADS = path.join(ML_ROOT, "ml_engine", "uploads");
export const ML_CONFIG = path.join(ML_ROOT, "ml_engine", "config.json");
export const ML_META = path.join(ML_ROOT, "ml_engine", "models", "model_metadata.json");
mkdirSync(ML_UPLOADS, { recursive: true });

export type MlPayload = {
  teachers_csv: string;
  students_csv: string;
  classrooms_csv: string;
  config?: {
    working_days?: string[];
    hours_per_day?: number;
    division_settings?: Record<string, { days_per_week?: number; hours_per_day?: number }>;
  };
};

export function saveMlPayload(payload: MlPayload) {
  writeFileSync(path.join(ML_UPLOADS, "teachers.csv"), payload.teachers_csv, "utf8");
  writeFileSync(path.join(ML_UPLOADS, "students.csv"), payload.students_csv, "utf8");
  writeFileSync(path.join(ML_UPLOADS, "classrooms.csv"), payload.classrooms_csv, "utf8");
  if (payload.config) writeFileSync(ML_CONFIG, JSON.stringify(payload.config, null, 2), "utf8");
}

export function loadMlPayload(): MlPayload | null {
  const files = ["teachers.csv", "students.csv", "classrooms.csv"].map((x) => path.join(ML_UPLOADS, x));
  if (!files.every(existsSync)) return null;
  let config: MlPayload["config"] = undefined;
  if (existsSync(ML_CONFIG)) {
    try { config = JSON.parse(readFileSync(ML_CONFIG, "utf8")); } catch { config = undefined; }
  }
  return {
    teachers_csv: readFileSync(files[0], "utf8"),
    students_csv: readFileSync(files[1], "utf8"),
    classrooms_csv: readFileSync(files[2], "utf8"),
    config,
  };
}

export async function runMlEngine(command: "inspect" | "train" | "generate", payload: MlPayload) {
  if (!existsSync(ML_ENGINE)) throw new Error(`ML engine not found at ${ML_ENGINE}`);
  const venvCandidates = process.platform === "win32"
    ? [
        path.join(ML_ROOT, ".venv", "Scripts", "python.exe"),
        path.join(ML_ROOT, "..", ".venv", "Scripts", "python.exe"),
      ]
    : [
        path.join(ML_ROOT, ".venv", "bin", "python"),
        path.join(ML_ROOT, "..", ".venv", "bin", "python"),
      ];
  const defaultVenvPython = venvCandidates.find(existsSync);
  const fallbackPython = process.platform === "win32" ? "python" : "python3";
  const pythonCandidates = [...new Set([process.env.PYTHON_BIN, defaultVenvPython, fallbackPython].filter(Boolean) as string[])];
  let stdout = "";
  let launchFailure: Error | undefined;

  for (const python of pythonCandidates) {
    try {
      stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(python, [ML_ENGINE, command], {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let out = "";
        let err = "";
        let failedToLaunch = false;
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("ML engine timed out after 180 seconds."));
        }, 180000);
        child.stdout.on("data", (chunk) => { out += String(chunk); });
        child.stderr.on("data", (chunk) => { err += String(chunk); });
        child.on("error", (error) => {
          failedToLaunch = true;
          clearTimeout(timer);
          reject(Object.assign(error, { failedToLaunch }));
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code !== 0) {
            // Windows venv launchers can start successfully yet exit after
            // reporting that the base Python recorded in pyvenv.cfg is gone.
            // Treat that as an unavailable interpreter and try the next one.
            if (/did not find executable at/i.test(err)) {
              reject(Object.assign(new Error(err.trim()), { failedToLaunch: true }));
              return;
            }
            let detail = err.trim();
            if (!detail && out.trim()) {
              try {
                const parsed = JSON.parse(out.trim().split(/\r?\n/).filter(Boolean).pop() || "{}");
                detail = parsed.error || parsed.trace || out.trim();
              } catch { detail = out.trim(); }
            }
            reject(new Error(detail || `ML engine exited with code ${code}.`));
            return;
          }
          resolve(out);
        });
        child.stdin.write(JSON.stringify(payload));
        child.stdin.end();
      });
      break;
    } catch (error) {
      if ((error as Error & { failedToLaunch?: boolean }).failedToLaunch) {
        launchFailure = error as Error;
        continue;
      }
      throw error;
    }
  }
  if (!stdout) throw launchFailure || new Error("No Python interpreter could be started for the ML engine.");
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  const raw = lines[lines.length - 1] || "";
  let result: any;
  try { result = JSON.parse(raw); } catch { throw new Error(`ML engine returned invalid JSON. ${raw}`); }
  if (!result.ok) throw new Error(result.error || "ML engine failed.");
  return result;
}
