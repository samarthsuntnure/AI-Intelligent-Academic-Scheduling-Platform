$ErrorActionPreference = 'Stop'
Write-Host '=== VIT AI Timetable local verification ===' -ForegroundColor Cyan
if (-not (Test-Path '.env')) { throw '.env is missing. Copy .env.example to .env and set DATABASE_URL.' }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw 'pnpm is not installed or not on PATH.' }
if (-not (Test-Path '.\.venv\Scripts\python.exe')) { throw 'Python virtual environment not found at .\.venv. Create it with: python -m venv .\.venv' }
& '.\.venv\Scripts\python.exe' -m pip check
pnpm db:push
Write-Host 'Database/schema check passed.' -ForegroundColor Green
Write-Host 'Run pnpm import-csv -- --reset if you need to load the bundled institutional data.'
