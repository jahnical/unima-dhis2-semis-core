# Correct the enrollment lifecycle: status, dates and transfers

## What changed

SEMIS keeps one DHIS2 enrollment per learner (or staff member) per academic year. This change makes
the enrollment's status and dates mean something, and stops transfer approval from moving records
that belong to the sending school.

- **Status** comes from one set of rules (`enrollmentLifecycle.ts` in `dhis2-semis-functions`):
  - `ACTIVE`: the current year, or the next one after promotion or carry-forward;
  - `COMPLETED`: a final result that is not a dropout, or a past year entered afterwards;
  - `CANCELLED`: a dropout.
  
  A new ACTIVE enrollment closes the previous ACTIVE one in the same payload, so a person never has
  two (DHIS2 rule E1015). An admission-only enrollment is filled instead of creating a second one.
- **Dates:** `occurredAt` is the start of the academic year from `semis/schoolCalendar`. `enrolledAt`
  is the enrollment date entered, and defaults to that start. Final results, transfers, bulk
  imports and edits no longer change either date; an edit changes `enrolledAt` only when the date
  itself was edited. If the year is missing from the calendar, the entered date is used and a
  warning is shown.
- **Transfers:** approval transfers ownership, then sends an events-only payload:
  - the registration event and empty placeholder events move to the receiving school;
  - attendance, marks and other events with data stay at the school where they were captured;
  - the enrollment is not changed.
- **New events** are created at the school of the learner's registration event, not at the
  enrollment's org unit.
- **Bulk final-result import** now reads `final-result.dropoutStatusValues`, so dropouts are saved as
  `CANCELLED`. Before, it read `finalResult` and saved them as `COMPLETED`.
- **Staff** follow the same one-enrollment-per-year rule across all schools.
- **Migration script** in `scripts/migrate-enrollment-lifecycle/` corrects existing data (see its README).

Academic years are compared with `yearOrder` from `validateEnrollmentYear.ts`, now exported. A
range such as `2025/2026` starts in 2025. A plain code such as `2026` is the later year, so it is
read through its option label or the school calendar.

Submodule pull requests (branch `fix/enrollment-lifecycle` in each):

| Repository | Summary |
| --- | --- |
| malawi-dhis2-semis-customfunc (`libs/functions`) | Lifecycle helpers, learner-enrollment hook, row org unit |
| malawi-dhis2-semis-components (`libs/components`) | Bulk import statuses and dates, dropout bug fix |
| emis-dhis2-semis-types (`libs/types`) | Staff section profile: one enrollment per year at any school |
| malawi-dhis2-semis-admission | Enroll from admission via the plan; admission edit keeps status and dates |
| malawi-dhis2-semis-enrollment | Create via the plan; edit keeps status, dates and event fields |
| malawi-dhis2-semis-final-result | Final result, promotion and carry-forward |
| malawi-dhis2-semis-transfer | Events-only transfer approval |

This repository: submodule pointers, `jest.config.js` (so `npm test` resolves the `dhis2-semis-*`
aliases and runs the script tests), the migration script, and this documentation.

## Why

- Every create path saved enrollments as `COMPLETED`, so a learner in class could have no `ACTIVE`
  enrollment, and status meant nothing to the Android app or to analytics.
- Promotion, final results and bulk imports overwrote the incident and enrollment dates with the
  day of the click.
- Transfer approval moved the whole enrollment, with its attendance and marks, to the receiving
  school, so the sending school lost that year's records.

## DHIS2 metadata (to be set by an administrator, on both the Student and the Staff program)

| Setting | Value | Why |
| --- | --- | --- |
| Only enroll once | **off** (`onlyEnrollOnce = false`) | One enrollment per academic year |
| Allow future enrollment dates | **on** (`selectEnrollmentDatesInFuture = true`) | Promotion creates next year's enrollment before it starts (E1020) |
| Allow future incident dates | **on** (`selectIncidentDatesInFuture = true`) | The incident date is the start of next year (E1021) |
| Show incident date | **on**, label **"Academic year start"** | Makes the incident date readable in the Capture app |

Without the two "future" settings, the tracker rejects promotion and carry-forward before the new
year begins.

## Data migration

Run `scripts/migrate-enrollment-lifecycle/migrate.ts` after deploying:

1. dry run on a copy of production;
2. review the report;
3. back up, then commit on the test server;
4. verify;
5. back up, then commit on production.

The README has the commands and rules. The script reuses the same helpers as the app.

## Test results

- **Unit tests** (`npm test`): 9 suites, 35 tests, all passing.
  - The 13 ported helper cases, adjusted to plain year codes, plus the transition builder.
  - The payload builders for admission, enrollment create and edit, final result, promotion and
    carry-forward, transfer approval and bulk import.
  - `formatRowsData` returning the registration event's org unit.
  - The migration planner.
- **TypeScript:** no new errors. 198 errors remain, all already present before; 199 before this
  change, because one error in `usePromoteStudents.ts` went away.
- **Build** (`npm run build-unix`): succeeds.
- **Migration dry run:** checked end to end against a local mock server (paging, VALIDATE mode, report
  rows, a rejected object, missing token). **Not yet run on the development server:** it needs a
  `DHIS2_TOKEN` for `emis42`.
- **Manual scenarios:** not run yet; they need a browser session on the development server. Fill in
  the results below before merging.

| # | Scenario | Result |
| --- | --- | --- |
| 1 | Admit a learner: one ACTIVE enrollment, no events | |
| 2 | Enroll that learner for the current year from Admission: same enrollment reused, registration event added, `occurredAt` = year start, ACTIVE | |
| 3 | Enroll the same learner for the same year again: blocked | |
| 4 | Back-capture a past year: separate COMPLETED enrollment, current ACTIVE unchanged | |
| 5 | Final result "Promoted": COMPLETED, `enrolledAt` and `occurredAt` unchanged | |
| 6 | Final result "Dropout": CANCELLED, row shows Dropout, attendance disabled | |
| 7 | Promote: new ACTIVE enrollment dated to next year's start, also before that year begins | |
| 8 | Staff carry-forward: same as 7 | |
| 9 | Approve a transfer mid-year: see the checks below | |
| 10 | Reject a transfer: only the transfer event status changes | |
| 11 | Bulk import enrollments: current year ACTIVE, past years COMPLETED | |
| 12 | Bulk import final results with a dropout value: CANCELLED, dates unchanged | |
| 13 | Edit an enrollment: status and dates unchanged unless the date was edited | |
| 14 | Android (`dhis2-emis-unima-android`, `emis-unima-main`) after a sync: class lists, attendance and marks as before, dropouts inactive, transferred learner at the receiving school | |

Checks for scenario 9:
- ownership moves;
- the registration event and empty events move to the destination;
- earlier attendance and marks stay at the origin;
- enrollment status, dates and org unit are unchanged;
- the learner appears in the destination's lists and not the origin's;
- new attendance and marks at the destination are saved with the destination org unit.

## Notes for reviewers

- **Admission and search screens:** the enroll modals now fetch the learner's enrollments from every
  school when the form is submitted, and decide there. The row fields `enrollableEnrollmentId`,
  `activeEnrollmentToComplete` and `activeEnrollmentEnrolledAt` are gone.
- **Promotion:** anyone already registered in the target year, or enrolled in a later year, is
  skipped for both sections. The staff profile's `promotionSkipsExistingYear` is now `true`, so the
  existing notice shows for staff too.
- **Bulk create imports** only ever create new people (existing ones are rejected by the file
  validation), so they never collide with an existing ACTIVE enrollment. **Bulk updates** send back
  the saved status, org unit and dates.
- **Enrollment edit:** if the academic year is changed, `occurredAt` moves to the new year's start.
  The edit does not check the one-per-year rule for the new year; that is left as it was.
- **Out of scope:** the Android app, the BAO analytics views in `analytics/`, listing by program
  ownership, and choosing a class at transfer approval.
