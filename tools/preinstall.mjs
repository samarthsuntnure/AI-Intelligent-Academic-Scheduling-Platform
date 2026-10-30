// Cross-platform replacement for the old `sh -c '...'` preinstall script,
// which failed on plain Windows (no `sh` on PATH without Git Bash/WSL).
// Plain Node works everywhere, so this does the same two things:
//   1. Removes stray package-lock.json / yarn.lock (this is a pnpm-only repo).
//   2. Refuses to continue if something other than pnpm ran `install`.
import { existsSync, unlinkSync } from "node:fs";

for (const file of ["package-lock.json", "yarn.lock"]) {
  if (existsSync(file)) {
    unlinkSync(file);
  }
}

const userAgent = process.env.npm_config_user_agent || "";
if (!userAgent.startsWith("pnpm")) {
  console.error('This repo uses pnpm. Run "pnpm install" instead.');
  process.exit(1);
}
