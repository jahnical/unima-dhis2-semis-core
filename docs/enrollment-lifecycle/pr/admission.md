# Enroll from admission with the lifecycle rules; admission edit keeps enrollment status and dates

Part of the enrollment lifecycle change. The core repository pull request has the full description.

## What changed

- **`enrollmentPostBody`:** the scenario A/B/C logic and the status rule, which made every
  non-default year COMPLETED including future years, are replaced by a `TransitionPlan`:
  - the admission-only enrollment is filled;
  - an earlier ACTIVE year is completed in the same payload, keeping its dates;
  - a past year is created COMPLETED; the current or a future year ACTIVE.
  
  Dates come from `enrollmentDates`.
- **`EnrollSingleModal` and `EnrollBulkModal`:**
  - both plan when the form is submitted, from the learner's enrollments at every school (new hook
    `usePlanAdmissionEnrollment`);
  - a conflict (already registered for the year, or enrolled in a later year) stops the single
    enrollment; the bulk modal skips those learners with a warning;
  - a year missing from the school calendar shows a warning.
- **Callers:** the admission page, the action buttons and the search modal no longer pass
  `enrollmentId`, `activeEnrollmentToComplete` or `activeEnrollmentEnrolledAt`.
- **Admission edit (`admissionUpdateBody`):**
  - sends back the enrollment's own status, org unit and dates;
  - before, it set `ACTIVE` and the admission date, which reopened completed years and overwrote
    registered years' dates;
  - the admission date still changes `enrolledAt` and `occurredAt` while the enrollment is
    admission-only;
  - the edit form shows the saved admission-date attribute instead of the enrollment's incident date.

Tests: `formatEnrollmentPostBody.test.ts`.

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
