# AI/ML-Based Intelligent College Timetable Generation System

**Intelligent Scheduling Through Machine Learning and Constraint Optimization**

This project extends the existing VIT academic timetable application with a genuine end-to-end ML pipeline.

## What is actually ML here?

The system intentionally does **not** claim that a classifier can magically produce a conflict-free timetable.

The architecture is:

```text
Three CSV datasets
      ↓
Schema validation
      ↓
Missing-value / duplicate / invalid-record analysis
      ↓
Conservative cleaning
      ↓
Feature engineering
      ↓
Synthetic Training Data
      ↓
Decision Tree + Random Forest + Gradient Boosting
      ↓
Validation + model comparison
      ↓
Best model selection
      ↓
ML assignment suitability probability
      ↓
MILP constraint optimization (SciPy HiGHS)
      ↓
Hard-constraint validation
      ↓
Timetable Quality Score
```

The training labels are explicitly **Synthetic Training Data** because no historical timetable labels are assumed. The uploaded institutional data is never falsely presented as historical ML training labels.

The ML model learns a suitability/feasibility signal for teacher-room-time assignments. The optimization layer enforces hard constraints such as teacher conflicts, division conflicts, room conflicts, capacity, availability, daily hours, and weekly requirements.

## Main features

- Three separate CSV upload modules:
  - Teachers
  - Students / Divisions
  - Classrooms
- CSV schema validation
- Missing-value analysis
- Duplicate detection
- Invalid-record detection
- IQR-based outlier reporting without blindly deleting valid records
- Cleaned CSV downloads
- Admin-controlled working days
- Admin-controlled academic hours/day
- Multiple divisions
- Division-specific configuration structure
- Synthetic candidate-assignment training dataset
- Decision Tree, Random Forest and Gradient Boosting comparison
- 70/15/15 train/validation/test split
- Accuracy, precision, recall, F1, confusion matrix and ROC-AUC
- Actual tree-model feature importance
- ML-based assignment scoring
- MILP constraint optimization
- Timetable validation
- Timetable quality score
- Sample dataset + one-click sample demo
- Existing VIT timetable UI, authentication and database preserved
- Full timetable generation uses the ML + optimization pipeline
- Scoped legacy regeneration remains available for reservation-aware single-division regeneration

## CSV formats

### Teachers

Required:

```csv
teacher_id,teacher_name
T001,Example Teacher
```

Recommended:

```csv
teacher_id,teacher_name,department,subject,max_hours_per_week,preferred_days,preferred_time_slots,unavailable_days,unavailable_slots
```

### Students / divisions

Required:

```csv
division
CSE-A
```

Recommended:

```csv
student_id,student_name,department,year,semester,division,roll_number,subjects,academic_hours_required,student_count
```

Subjects can be written as:

```text
Data Structures:3;Database Systems:3;Machine Learning:3
```

Practical components can be explicitly marked:

```text
Machine Learning [Lab]:2
```

Tutorial components can be marked:

```text
Cloud Computing [Tutorial]:1
```

### Classrooms

Required:

```csv
room_number,room_type,capacity
101,lecture,50
LAB1,lab,25
```

Recommended fields include availability and equipment:

```csv
classroom_id,room_number,building,floor,room_type,capacity,department,available_days,available_slots,has_projector,has_computer,has_lab,lab_type
```

## Windows / VS Code setup

### 1. Install Node.js

Use a current LTS release.

### 2. Install pnpm

```powershell
corepack enable
corepack prepare pnpm@latest --activate
```

### 3. Install Python

Python 3.10+ is recommended.

### 4. Create the ML virtual environment

PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements-ml.txt
```

If `py` is unavailable:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-ml.txt
```

### 5. Install Node dependencies

```powershell
pnpm install
```

### 6. Configure the database

Copy:

```text
.env.example
```

to:

```text
.env
```

Set `DATABASE_URL` to a reachable MySQL 8 database.

### 7. Initialize the database

```powershell
pnpm db:push
```

For the supplied institutional seed/import flow:

```powershell
pnpm import-csv
```

### 8. Run the application

```powershell
pnpm dev
```

Open the Vite URL shown by the terminal.

## ML Studio demonstration

1. Sign in as Admin.
2. Open **AI/ML Studio**.
3. Upload:
   - `teachers.csv`
   - `students.csv`
   - `classrooms.csv`
4. Choose working days.
5. Set academic hours/day.
6. Click **Validate & Clean**.
7. Review the actual data-quality counts.
8. Click **Train & Compare Models**.
9. Review:
   - model comparison
   - selected model
   - validation metrics
   - test metrics
   - confusion matrix
   - ROC-AUC
   - feature importance
10. Click **Generate Timetable**.
11. Review:
   - ML assignment scores
   - candidate count
   - required task count
   - optimization result
   - hard conflicts
   - timetable quality score

The generated timetable can also be produced from the main Admin timetable generation action. The full-generation path calls the same ML engine and writes the resulting sessions into the existing timetable database.

## Model storage

```text
ml_engine/
├── engine.py
├── sample_data/
├── uploads/
└── runtime configuration

models/
├── best_model.joblib
└── model_metadata.json
```

`uploads/` contains the latest Admin-uploaded datasets and is intentionally treated as runtime data.

The saved model is reused until Admin retrains it.

## Optimization

The optimizer uses `scipy.optimize.milp`, backed by HiGHS.

Hard constraints include:

- one assignment per required session
- no teacher overlap
- no room overlap
- no division overlap
- classroom capacity
- lab room requirement
- teacher unavailable slots
- classroom unavailable slots
- daily academic-hour limits
- weekly subject-hour requirements

The final validator checks the selected solution again before reporting the quality score.

## Existing application architecture

The original application is retained:

```text
React / Vite frontend
        ↓
Express API server
        ↓
Drizzle ORM
        ↓
MySQL
```

The ML extension adds:

```text
Express API
    ↓
Python ML engine
    ↓
scikit-learn
    ↓
SciPy MILP / HiGHS
```

The API invokes the Python engine locally; no external AI API is required.

## Tests performed

The completed project was tested at the ML-engine level with:

- valid sample inspection
- CSV cleaning and quality reporting
- missing-column rejection
- model training
- 70/15/15 train/validation/test execution
- model comparison
- best-model selection
- saved model creation
- candidate ML scoring
- MILP timetable generation
- zero-conflict validation on the bundled sample
- quality-score calculation
- multiple divisions
- teacher/room/division resource constraints

The local execution environment used for this build did not have network access, so dependency installation and the complete React/Node build could not be executed here. The final ZIP therefore includes the exact dependency manifests and Windows setup needed for a normal connected VS Code environment.

## Limitations

- Synthetic labels are not historical college outcomes.
- Uploaded CSVs need to describe enough subject requirements to generate a complete timetable.
- Very large institutional schedules may require increasing the MILP time limit or candidate-pruning strategy.
- Existing MySQL authentication remains part of the original application.

## Future scope

- Historical timetable labels for supervised learning
- learned preference models from faculty feedback
- stronger batch-level lab optimization
- calendar integrations
- multi-semester planning
- Pareto optimization of workload, gaps and room utilization
- explainable per-assignment ML recommendations

## Project title

**AI/ML-Based Intelligent College Timetable Generation System**

### Tagline

**Intelligent Scheduling Through Machine Learning and Constraint Optimization**
