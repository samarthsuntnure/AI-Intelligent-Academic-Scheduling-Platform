# AI Academic Scheduling Platform

An academic operations dashboard for managing college scheduling data and preparing conflict-aware timetable generation.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/academic-scheduler` — responsive web dashboard and route-level pages.
- `artifacts/api-server` — Express API mounted at `/api`.
- `lib/api-spec/openapi.yaml` — source of truth for API contracts.
- `lib/db/src/schema/index.ts` — Drizzle PostgreSQL schema.
- `lib/api-client-react` and `lib/api-zod` — generated client hooks and validation schemas.

## Architecture decisions

- The frontend uses generated React Query hooks from the OpenAPI contract rather than hand-written request types.
- The dashboard is a logic-heavy operations cockpit: scheduling data and conflict visibility are first-class surfaces.
- The initial database includes small demo records so the dashboard is useful on first load.
- `nextGeneration` is returned as an ISO timestamp because the client renders it with native date formatting.

## Product

- Dashboard overview with live counts for students, faculty, subjects, scheduled classes, and conflicts.
- Timetable view with schedule entries and conflict review.
- Student directory with search and CRUD interactions.
- Faculty directory and subject catalog with create flows.
- Foundation for future availability, room, constraint, and AI timetable-generation modules.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run API code generation after every OpenAPI change.
- Refresh shared library declarations with `pnpm run typecheck:libs` before checking API server types after schema changes.
- The generated Zod client requires Zod 4 syntax support.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
