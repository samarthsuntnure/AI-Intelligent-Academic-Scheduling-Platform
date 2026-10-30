$ErrorActionPreference = 'Stop'
Write-Host '=== VIT AI Timetable - Windows setup ===' -ForegroundColor Cyan

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw 'Python is not installed. Install Python 3.11+ and retry.'
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw 'pnpm is not installed. Run: corepack enable; corepack prepare pnpm@latest --activate'
}

if (-not (Test-Path '.venv\Scripts\python.exe')) {
  Write-Host 'Creating Python virtual environment...' -ForegroundColor Yellow
  python -m venv .venv
}

Write-Host 'Installing Python ML dependencies...' -ForegroundColor Yellow
& '.venv\Scripts\python.exe' -m pip install --upgrade pip
& '.venv\Scripts\python.exe' -m pip install -r requirements-ml.txt

if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host 'Created .env from .env.example. Edit DATABASE_URL before continuing.' -ForegroundColor Yellow
  throw 'Set DATABASE_URL in .env, then rerun this setup script.'
}

Write-Host 'Installing Node dependencies...' -ForegroundColor Yellow
pnpm install

Write-Host 'Pushing database schema...' -ForegroundColor Yellow
pnpm db:push

Write-Host 'Importing bundled sample/institutional data...' -ForegroundColor Yellow
pnpm import-csv -- --reset

Write-Host ''
Write-Host 'Setup complete.' -ForegroundColor Green
Write-Host 'Run backend:  pnpm dev:api'
Write-Host 'Run frontend: pnpm dev:web'
Write-Host 'Open:         http://localhost:5173'
Write-Host 'Admin:        admin@vit.edu / Admin@123'
