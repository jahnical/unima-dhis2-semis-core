# Enrollment create and edit follow the lifecycle rules

Part of the enrollment lifecycle change. The core repository pull request has the full description.

## What changed

- **Create (`ModalManager`, `enrollmentPostBody`):**
  - fetches the person's enrollments and runs `planEnrollmentTransition`;
  - status is ACTIVE for the current or a future year, COMPLETED for a past year; before, it was
    always COMPLETED;
  - an earlier ACTIVE enrollment is completed in the same payload;
  - "already registered for this academic year" and "already enrolled in a later year" show an
    alert, and nothing is saved;
  - `occurredAt` is the academic year start.
- **Edit (`enrollmentUpdateBody`):**
  - sends back the enrollment's own status, org unit and dates, and no longer sets `createdAt`;
  - `enrolledAt` changes only when the enrollment date was edited; `occurredAt` moves only when
    the academic year was changed;
  - existing events keep their org unit, dates and status;
  - new events are created at the registration event's school;
  - the form shows the enrollment's `enrolledAt` as the enrollment date.
- **Enroll from admission:** `EnrollmentActionsButtons` no longer passes the removed props.

Tests: `enrollmentBodies.test.ts`.

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
