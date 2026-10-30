# VIT timetable dataset

This package uses the supplied institutional exports as the source of truth.

## Imported divisions
- TY-A: 75
- TY-B: 47
- TY-C: 74
- TY-D: 75
- TY-E: 73
- TY-F: 74
- TY-G: 48
- AIML-B: 27
- Total: 493

## Choice registrations
The student export contains the choice column. MLOPS variants such as `MLOOPS`, `MLOPS`, `MLOOPs` and `ML OOps` are normalized to `MLOPS`; network variants are normalized to `CN`. The generated `choice-registrations.csv` contains only PRNs that are present in the source export.

## Rooms
Lecture: 4005, 4006, 4207, 4307

Labs: 4003, 4007, 4008, 4304A, 4308, 4309

## Subjects
DAA: Theory 3h + Lab 2h
Machine Learning: Theory 3h + Lab 2h
Cloud Computing: Theory 3h + Tutorial 1h
Computer Networks: Theory 3h + Lab 2h
MLOPS: Theory 3h + Lab 2h
Coursera 1: Theory 1h
Coursera 2: Theory 1h
DT: Tutorial 1h
