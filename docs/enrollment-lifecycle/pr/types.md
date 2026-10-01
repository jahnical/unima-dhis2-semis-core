# Staff: one enrollment per academic year at any school

Part of the enrollment lifecycle change. The core repository pull request has the full description.

## What changed

The staff section profile now follows the same rule as students: one enrollment per academic year
across all schools.
- `enrollmentCheckScopedToSchool` is `false`: the search list treats a staff member registered
  that year at another school as already enrolled.
- `promotionSkipsExistingYear` is `true`: re-enrollment skips anyone already registered in the
  target year, and the notice says so.

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
