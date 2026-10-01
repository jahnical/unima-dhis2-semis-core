# Final result, promotion and carry-forward follow the lifecycle rules

Part of the enrollment lifecycle change. The core repository pull request has the full description.

## What changed

- **Assign final result** (`finalResultTrackedEntity`):
  - the status comes from `statusForFinalResult` (CANCELLED for a dropout value, otherwise
    COMPLETED);
  - the enrollment is fetched and its own org unit, `enrolledAt` and `occurredAt` are sent back;
    before, they were set to the event date, today, or the header school;
  - the final-result event is still dated today, and a new one is created at the registration
    event's school.
- **Promotion (`usePromoteStudents`)** and **staff carry-forward (`useCarryForward`)** share
  `newYearTrackedEntity`/`newYearEvents`:
  - the new enrollment follows `planEnrollmentTransition` (normally ACTIVE; before, COMPLETED);
  - `enrolledAt` is the enrollment date entered (default: the target year's start), and
    `occurredAt` is the target year's start (before: today);
  - a previous year still ACTIVE (no final result) is completed in the same payload;
  - anyone already registered in the target year, or enrolled in a later one, is skipped, for both
    sections;
  - the socio-economics copy and the placeholder stages are unchanged.

Tests: `finalResultPayload.test.ts`, `newYearPayload.test.ts`.

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
