# Enrollment lifecycle helpers

Part of the enrollment lifecycle change. The core repository pull request has the full description
and the manual test list.

## What changed

- **New `utils/enrollment/enrollmentLifecycle.ts`**, exported from the package. It holds the
  enrollment rules as pure functions:
  - `planEnrollmentTransition` decides whether to reuse the admission-only enrollment, which
    earlier ACTIVE enrollment to complete, or reports a conflict (already registered for the year,
    or enrolled in a later year);
  - `statusForNewEnrollment` and `statusForFinalResult`;
  - `enrollmentDates` and `getAcademicYearDates` (`occurredAt` is the academic year start from the
    school calendar);
  - `closeEnrollmentPayload` and `keepEnrollmentFields` send back an enrollment's own org unit and
    dates;
  - `enrollmentsForTransition` builds the closings and the new enrollment for one payload;
  - `buildTransferApprovalEvents`: only the registration event and empty events move on approval.
  
  Tests: `enrollmentLifecycle.test.ts`.
- **Academic years are compared with `yearOrder`,** now exported from `validateEnrollmentYear.ts`,
  so plain codes such as `2026` (= 2025/2026) are read correctly.
- **New `useGetLearnerEnrollments` hook** (`getLearnerEnrollments`, `planEnrollments`) fetches a
  person's enrollments and events from every school, 50 people per request. Also adds
  `TRANSITION_CONFLICT_MESSAGES`.
- **`formatRowsData`:** `orgUnitId` is now the registration event's org unit, the school where the
  learner is registered now. Attendance, marks and final results create new events there.
- **`formatAdmissionRowsData`:**
  - drops `enrollableEnrollmentId`, `activeEnrollmentToComplete` and `activeEnrollmentEnrolledAt`
    (the enroll modals plan when the form is submitted);
  - without an ACTIVE enrollment, the row uses the enrollment of the latest registration.

## Why

Statuses were always COMPLETED, dates were overwritten by later operations, and transfer approval
moved attendance and marks to the receiving school.

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
