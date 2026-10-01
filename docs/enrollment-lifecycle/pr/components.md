# Bulk import: enrollment statuses and dates, dropout fix

Part of the enrollment lifecycle change. The core repository pull request has the full description.

## What changed

- **`generateEnrollmentData`:**
  - new enrollments get their status from the academic year (past years COMPLETED, otherwise
    ACTIVE); admissions are ACTIVE;
  - `occurredAt` is the academic year start, and `enrolledAt` is the date in the sheet (default:
    the year start);
  - years missing from the school calendar appear as warnings in the import summary;
  - updates no longer set a status or dates.
- **`generateFinalResultData`:**
  - reads `dataStore["final-result"].dropoutStatusValues` (bug fix: it read `finalResult`, so
    dropouts were saved as COMPLETED);
  - uses the configured final-result status column;
  - no longer sets `enrolledAt` or `occurredAt` to today.
- **`postEnrollments`:**
  - for updates and final results, fetches the saved enrollments and sends back their org unit and
    dates, plus their status for plain updates;
  - chunking and progress reporting are unchanged.
- **`ModalSearchAdmissionContent`:** `onSelectTeiForEnrollment` passes only the tracked entity and
  the initial values; the enroll modal plans the enrollment itself.

A bulk *create* only creates new people (the file validation rejects existing ones), so it cannot
collide with an existing ACTIVE enrollment.

Tests: `createEventsObject.test.ts`.

## DHIS2 metadata

Set by an administrator on both the Student and the Staff program:
- Only enroll once: **off** (`onlyEnrollOnce = false`).
- Allow future enrollment dates: **on** (`selectEnrollmentDatesInFuture = true`).
- Allow future incident dates: **on** (`selectIncidentDatesInFuture = true`).
- Show incident date: **on**, label "Academic year start".

Without the two "future" settings, promotion and carry-forward before the new year starts are rejected (E1020, E1021).

## Test results

- `npm test` in the core repository: 9 suites, 35 tests, all passing.
- TypeScript: no new errors.
- `npm run build-unix`: succeeds.
- Manual scenarios: listed in the core pull request, to be run on the development server.
