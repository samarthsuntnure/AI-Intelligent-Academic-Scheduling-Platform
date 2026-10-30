# VIT AI Timetable — Local Setup

## Requirements
- Node.js 20+ (Node 22 works)
- pnpm 10+
- MySQL 8.x running locally
- Python 3.10+ for the ML engine

## 1. Configure the database

The project expects:

`DATABASE_URL=mysql://root:YOUR_PASSWORD@127.0.0.1:3306/vidyaan`

Update `.env` if your MySQL password/database differs.

## 2. Install dependencies

Node:

```powershell
pnpm install
```

ML engine:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements-ml.txt
```

The ML engine uses scikit-learn for model training and SciPy/HiGHS for mixed-integer constraint optimization. No external AI API is required.

## 3. Create/update tables

```powershell
pnpm db:push
```

## 4. Import the supplied VIT data

The included data files are the supplied student and faculty exports. Rooms are defined in `scripts/src/import-csv.ts` and documented in `data/rooms.csv`.

For a fresh local database import:

```powershell
pnpm import-csv -- --reset
```

The importer normalizes:
- TY A/TY B/... section blocks into TY-A/TY-B/...;
- AIML-B;
- MLOPS spelling variants from the original student export;
- CN/network variants;
- faculty availability and OFF days;
- the supplied room list.

It also recreates `data/choice-registrations.csv` from the source student export.

## 5. Start the application

```powershell
pnpm dev
```

Open:

`http://localhost:5173`

API:

`http://localhost:5000`

## Default admin account

`admin@vit.edu`

`Admin@123`

## Scheduling rules implemented

- Monday–Saturday, 08:00–18:00
- Sunday mandatory holiday
- One configurable/automatic second holiday per division
- Faculty availability and faculty holiday respected
- Faculty lunch protected between 12:00–14:00
- Labs cannot cross lunch
- No faculty overlap
- No room overlap
- No division overlap
- Theory, Lab and Tutorial are distinct timetable types
- Maximum two empty hourly periods between student classes on a day
- Manual faculty assignment by subject + division
- Manual timetable create/edit/delete
- MLOPS remains fixed to Dr.Angdi
- MLOPS is scheduled as one shared choice cohort because the supplied data has MLOPS selections across every division; this prevents impossible duplicate Dr.Angdi sessions while still showing the session to each registered student's timetable.
