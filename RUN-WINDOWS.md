# Windows Run Guide — AI/ML Timetable

## Requirements
- MySQL Server 8.x (MySQL Workbench is only the GUI; the MySQL Server service must be running)
- Node.js 20+
- pnpm 10+
- Python 3.11+

## First-time setup

Open PowerShell in this folder:

```powershell
cd "C:\path\to\VIT-AI-Timetable-ML-Final\final_work2"
```

Create `.env` from `.env.example` and set:

```env
DATABASE_URL=mysql://root:YOUR_MYSQL_PASSWORD@127.0.0.1:3306/vidyaan
JWT_SECRET=replace-with-a-long-random-local-secret
API_PORT=5000
WEB_PORT=5173
API_PROXY_TARGET=http://localhost:5000
```

Create the database in Workbench if necessary:

```sql
CREATE DATABASE IF NOT EXISTS vidyaan;
```

Then:

```powershell
pnpm install
.venv\Scripts\python.exe -m pip install -r requirements-ml.txt
pnpm db:push
pnpm import-csv -- --reset
```

## Run

Use two terminals to avoid accidentally starting the API twice.

Terminal 1:

```powershell
pnpm dev:api
```

Wait for `Server listening` on port `5000`.

Terminal 2:

```powershell
pnpm dev:web
```

Open `http://localhost:5173`.

## Checks

API:

```text
http://localhost:5000/api/healthz
http://localhost:5000/api/readyz
```

Expected readiness response:

```json
{"status":"ready","database":"ok","api":"ok"}
```

## Admin

Email: `admin@vit.edu`
Password: `Admin@123`

The API ensures this local admin account exists at startup.

## Troubleshooting

- `EADDRINUSE port 5000`: do not start a second API. Close the old API terminal/process, then run `pnpm dev:api` once.
- `ER_ACCESS_DENIED_ERROR`: fix `DATABASE_URL` to use the same MySQL password/port as Workbench.
- `ML engine exited with code 1`: ensure `.venv` is activated or leave the bundled `.venv` path configured; the API automatically prefers `.venv\\Scripts\\python.exe` on Windows (and also supports a parent-folder `.venv`).
- Manual session creation errors are returned as a clear validation message instead of a generic request failure.
