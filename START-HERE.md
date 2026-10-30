# START HERE — VIT AI/ML Timetable

## Requirements
- Windows 10/11
- MySQL Server 8.x + MySQL Workbench
- Node.js 20+
- pnpm 10+
- Python 3.11+

## First run
1. Start MySQL Server.
2. In MySQL Workbench run: CREATE DATABASE IF NOT EXISTS vidyaan;
3. Copy .env.example to .env and put your real MySQL password in DATABASE_URL.
4. Run:

```powershell
pnpm install
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-ml.txt
pnpm db:push
pnpm import-csv -- --reset
```

You can also run .\scripts-local\setup-windows.ps1 after creating .env.

## Run every day
Terminal 1: pnpm dev:api

Terminal 2: pnpm dev:web

Open http://localhost:5173.

## Admin
admin@vit.edu / Admin@123

The API also ensures this local admin exists at startup.

## Health checks
- http://localhost:5000/api/healthz
- http://localhost:5000/api/readyz

## ML demo
AI/ML Studio → Load Sample Dataset → Validate & Clean → Train Model → Generate Timetable.

## Important
Do not run pnpm dev while pnpm dev:api is already running. That starts a second API and causes EADDRINUSE on port 5000.
