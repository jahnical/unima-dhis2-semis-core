# Enrollment check

Finds enrollment problems on a SEMIS server and, only when asked, fixes the safe ones. Run it after
bulk imports and promotions, and before reading the analytics.

| Finding | What it means | Fix (option) |
|---|---|---|
| `EMPTY_ENROLLMENT` | An enrollment without a registration event: no year, standard or class. The admission step creates one; it used to stay ACTIVE when the learner was then enrolled in a past year. | Deleted when it has no events at all and the learner has another enrollment with a registration event (`--delete-empty`). Otherwise reported only. |
| `DUPLICATE_YEAR` | Two enrollments for the same academic year. | Reported only: decide which one to keep. |
| `MULTIPLE_ACTIVE` | More than one ACTIVE enrollment. Usually goes away with the other fixes. | Reported only. |
| `EVENT_DATE_OUTSIDE_YEAR`, `STAGE_EVENT_DATE` | An event dated outside its enrollment's academic year (promotion used to date every event of the new year on the day of the promotion), or a performance term or final-result event inside the year but not on its term end / year end (these events used to keep the enrollment date). Attendance and transfer events are not checked. | Registration (and other stages): the enrollment date; performance term N: the last day of term N; final result: the last day of the year; never after today (`--fix-event-dates`). |
| `STATUS_NOT_MATCHING_RESULT` | A dropout on an enrollment that is not CANCELLED, or another final result on one still ACTIVE. | CANCELLED for a dropout, otherwise COMPLETED; dates and school unchanged (`--fix-status`). |

## Run

Node 20+, a personal access token of a user who can read (and, to fix, write) the learners.

```sh
export DHIS2_BASE_URL=https://project.ccdev.org/emis
export DHIS2_TOKEN=d2pat_...

# 1. Report only (reads, changes nothing)
npx tsx scripts/check-enrollments/check.ts --org-unit p9O830O02UX

# 2. Validate the fixes (the server checks them; nothing is saved)
npx tsx scripts/check-enrollments/check.ts --org-unit p9O830O02UX --fix-event-dates --fix-status --delete-empty

# 3. Save them
npx tsx scripts/check-enrollments/check.ts --org-unit p9O830O02UX --fix-event-dates --fix-status --delete-empty --commit
```

Every finding is written to `enrollment-check-<timestamp>.csv` with its result (`REPORTED`, `WOULD FIX`,
`FIXED` or `ERROR ...`). Deleting an enrollment cannot be undone: take a backup before `--delete-empty --commit`.
