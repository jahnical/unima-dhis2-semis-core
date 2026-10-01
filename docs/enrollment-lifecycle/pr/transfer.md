# Transfer approval no longer moves records that belong to the sending school

Part of the enrollment lifecycle change. The core repository pull request has the full description.

## What changed

- **`useTransfer` approval:**
  - fetches every event of the enrollment, instead of one event per configured stage;
  - calls `tracker/ownership/transfer`, then sends an events-only payload
    (`transferApprovalPayload`, built on `buildTransferApprovalEvents`):
    - the registration event and empty placeholder events move to the receiving school;
    - events with data (attendance, marks, socio-economics) stay where they were captured;
    - the pending transfer event keeps its org unit, gets the approved status, and gets the
      destination when it had none;
  - the enrollment is not sent, so its status, dates and org unit stay as they are;
  - before, the enrollment was set COMPLETED at the new school and its events moved with it.
- **Removed:** `formatEnrollmentBody` and `useGetUsedProgramStages`, which have no other users.
- **Rejection** is unchanged.
- **`useSearchTransferEnrollments`:** `programId` comes from the enrollment that holds the pending
  request (falling back to the section's program) instead of the first ACTIVE enrollment. A learner
  whose year was already closed by a final result can still be transferred.

Tests: `transferApprovalPayload.test.ts`.

Existing data moved by earlier approvals can be put back with the migration script's
`--restore-transfer-history` option (core repository).

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
