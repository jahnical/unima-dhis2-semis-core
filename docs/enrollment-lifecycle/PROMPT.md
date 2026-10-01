# Task: Correct the SEMIS enrollment lifecycle (status, dates and transfers)

You are working in the SEMIS web application repository `unima-dhis2-semis-core` (DHIS2 App Platform, React 18, TypeScript). Modules and libraries are git submodules under `src/modules/` and `src/libs/`. SEMIS runs on DHIS2 2.41 or later and uses the new tracker API (`tracker/...`).

Read this whole prompt before changing anything. Then read every file listed in "Required changes" and confirm that the current behaviour matches what is described. If it does not, stop and report the difference before editing.

## 1. Background

SEMIS keeps **one DHIS2 enrollment per learner (or staff member) per academic year**. Each enrollment holds one registration event (academic year, standard, class), the term events, attendance events, a final result event and transfer events. This model stays. It fits DHIS2: an enrollment is an episode with a start, an end and an outcome.

The implementation misuses three parts of the model:

1. **Status has no meaning.** New enrollments are created COMPLETED by the Enrollment module, promotion, staff carry-forward and bulk import. Approving a transfer also sets COMPLETED. A learner in class can have no ACTIVE enrollment.
2. **Dates are overwritten.** Promotion sets the incident date (`occurredAt`) to the day of the click. Assigning a final result and bulk final-result import overwrite `enrolledAt` and `occurredAt` with the final-result date or today. Editing an enrollment resets `createdAt`.
3. **Transfers rewrite history.** On approval, `modules/transfer/src/utils/tei/enrollmentBody.ts` moves the enrollment and all its events (attendance, marks) to the receiving school. The sending school loses that year's records.

There is also a bug. `generateFinalResultData` in the bulk import reads `dataStore?.finalResult?.dropoutStatusValues`, but the data store key is `"final-result"`. As a result, bulk-imported dropouts are saved as COMPLETED instead of CANCELLED.

## 2. Target rules (normative)

- **R1. One enrollment per learner per academic year.** Keep the existing check that blocks a second registration for the same academic year.
- **R2. Status lifecycle.**
  - `ACTIVE`: the current academic year, or the next one after promotion or carry-forward.
  - `COMPLETED`: a final result that is not a dropout has been recorded, or the enrollment is created for a past academic year (back-capture).
  - `CANCELLED`: the final result value is listed in `dropoutStatusValues` for that section (student dropout, staff terminated).
  - At most one ACTIVE enrollment per tracked entity per program. This is DHIS2 validation E1015. When a new ACTIVE enrollment is created, close the previous ACTIVE one **in the same tracker payload**. If the learner has an ACTIVE admission-only enrollment (no registration event), fill that enrollment instead of creating a new one. The admission module already does this; generalise it.
- **R3. Dates.**
  - `occurredAt` (incident date) is the start date of the enrollment's academic year, read from `semis/schoolCalendar` > `schoolCalendar[].academicYear.startDate`.
  - `enrolledAt` is the enrollment date entered by the user, and defaults to the academic year start.
  - No later operation may change `enrolledAt` or `occurredAt`: not final results, transfers, bulk imports, or edits other than an explicit change of the enrollment date. On any enrollment update, send back the existing values.
  - If the academic year is missing from the calendar, fall back to the entered enrollment date and show a warning.
- **R4. Transfers.** On approval:
  - Call `tracker/ownership/transfer` first (existing call).
  - Then send an **events-only** payload in which:
    - the registration event moves to the receiving school;
    - events of the enrollment with no data values (empty placeholders) also move;
    - events that have data (attendance, marks, socio-economics) stay at the school where they were captured;
    - the transfer event keeps its org unit and gets the approved status code, plus the destination if it was empty.
  - Do not change the enrollment: status, dates and org unit stay as they are.
  - Rejection stays as it is (only the transfer event status changes).
- **R5. Org unit of new events.** New events are created at the school where the learner is currently registered. That is the registration event's org unit, which after R4 equals the school selected in the header. They are never created at `enrollment.orgUnit`. An update to an existing event keeps that event's own org unit.

## 3. Reference implementation

`docs/enrollment-lifecycle/reference/enrollmentLifecycle.ts` contains tested pure functions for R2 to R4:

- `planEnrollmentTransition`
- `statusForNewEnrollment`
- `statusForFinalResult`
- `enrollmentDates`
- `getAcademicYearDates`
- `closeEnrollmentPayload`
- `buildTransferApprovalEvents`

`enrollmentLifecycle.node-test.ts` in the same folder holds 13 cases, written for `node:test` (run them with `npx tsx --test docs/enrollment-lifecycle/reference/enrollmentLifecycle.node-test.ts`). The file name keeps Jest from picking it up.

1. Move the module to `src/libs/functions/src/utils/enrollment/enrollmentLifecycle.ts` and export it from `src/libs/functions/src/index.ts`, so modules import it from `dhis2-semis-functions`.
2. Port the tests to Jest (`d2-app-scripts test`) next to it. Keep all 13 cases.
3. Academic years are compared with `academicYearStart` (the first four digits). If the academic year option codes on the server do not contain the year, change the comparison to the ordering in `src/libs/functions/src/utils/validateEnrollmentYear.ts` (`yearOrder`, which also looks at option labels and the calendar). Export that function, rather than keeping two different comparisons.

## 4. Required changes

Paths are relative to `src/`. Do not edit anything under `.d2/` or `build/`.

**Shared**

1. `libs/functions/src/utils/enrollment/enrollmentLifecycle.ts`: new module (section 3).
2. `libs/functions/src/utils/table/rows/formatRowsData.tsx`: in `formatRowsData`, set `orgUnitId` from the registration event's org unit, not `currentEnrollment?.orgUnit`. Check every consumer of `orgUnitId`, including:
   - `modules/attendance/src/hooks/attendance/saveValues.ts`
   - `modules/attendance/src/utils/table/tableDataFormatter.ts`
   - `modules/performance/src/components/marks/FieldsPerformance.tsx`

**Admission and enrollment**

3. `modules/admission/src/utils/enrollment/formatEnrollmentPostBody.ts`: replace the A/B/C scenario logic and the status rule with `planEnrollmentTransition`. The current rule marks every year other than the default one as COMPLETED, including future years. Set dates with `enrollmentDates`. Closed enrollments keep their dates (`closeEnrollmentPayload`).
4. The enrollment-from-admission callers work out `enrollmentId` (admission-only enrollment to reuse) and `activeEnrollmentToComplete` from the first ACTIVE enrollment. Compute both with `planEnrollmentTransition` from the learner's enrollments and registration events instead. Keep the existing props if that is simpler. The callers are:
   - `libs/components/src/components/searchAdmission/ModalSearchAdmissionContent.tsx` (`onSelectTei`, around line 141)
   - `modules/admission/src/pages/admission/admission.tsx` (around lines 159 and 361)
   - `modules/admission/src/components/admissionButtons/AdmissionActionsButtons.tsx`
5. `modules/enrollment/src/utils/enrollment/formatEnrollmentPostBody.ts`: it creates enrollments with status COMPLETED. Fetch the tracked entity's existing enrollments in `modules/enrollment/src/components/modal/saveEnrollment/ModalManager.tsx`, run `planEnrollmentTransition`, and build one payload. On `ALREADY_REGISTERED_FOR_YEAR` or `LATER_YEAR_ALREADY_ACTIVE`, show an alert and do not save.
6. `modules/enrollment/src/utils/enrollment/formatEnrollmentUpdateBody.ts`: send the enrollment's existing status. Do not set `createdAt`. Change `enrolledAt` only if the user changed the enrollment date; `occurredAt` stays the academic year start. For existing events, keep their `orgUnit`, `occurredAt` and `status`. New events created during an edit follow R5.

**Final result, promotion and carry-forward**

7. `modules/final-result/src/components/assingFinalResult/assignFinalResult.tsx`:
   - Use `statusForFinalResult`.
   - Fetch the enrollment (`tracker/enrollments/{uid}`) and send back its own `orgUnit`, `enrolledAt` and `occurredAt`. Today it sends the final-result event date, today's date, or the header school.
   - The final-result event itself may still use today's date.
8. `modules/final-result/src/hooks/promote/usePromoteStudents.ts`:
   - Create the new enrollment with `planEnrollmentTransition` (normally `ACTIVE`). The previous year is already closed by the final result.
   - Set `enrolledAt` from `values.enrollment_date`, defaulting to the target year's start, and `occurredAt` to the target year's start.
   - Keep `promotionSkipsExistingYear`, the socio-economics copy and the placeholder stages.
9. `modules/final-result/src/hooks/promote/useCarryForward.ts`: same as item 8 for staff. It currently uses status COMPLETED and `occurredAt` = today.

**Transfers**

10. `modules/transfer/src/hooks/tei/useTransfer.ts` and `modules/transfer/src/utils/tei/enrollmentBody.ts`:
    - Fetch **all** events of the enrollment, with `event, programStage, orgUnit, occurredAt, scheduledAt, status, enrollment, trackedEntity, program, dataValues`. The current fetch is limited to `useGetUsedProgramStages`.
    - After the ownership transfer succeeds, upload `{ events: buildTransferApprovalEvents(...) }`.
    - Remove the tracked-entity and enrollment rewrite in `formatEnrollmentBody`, or delete the function if nothing else uses it.
    - Keep the rule that sets the destination to the approving school when it was empty.
11. `modules/transfer/src/hooks/tei/useSearchTransferEnrollments.ts` (around line 57): check the `status === 'ACTIVE'` lookup still does what the screen expects now that statuses are correct.

**Bulk import**

12. `libs/components/src/components/bulk/bulkImport/createEvents/createEventsObject.ts`:
    - `generateEnrollmentData`: status from `statusForNewEnrollment` (past years COMPLETED, others ACTIVE), dates from `enrollmentDates`.
    - `generateFinalResultData`: read `dataStore?.["final-result"]?.dropoutStatusValues` (bug fix) and use `statusForFinalResult`. Do not set `enrolledAt` or `occurredAt` to today; send the existing values (fetch the enrollments by UID in `postEnrollment.ts` before posting).
13. `libs/components/src/components/bulk/bulkImport/postEvents/postEnrollment.ts`: for existing learners, apply R2 so that a new ACTIVE enrollment never collides with an existing one (E1015). Keep the chunking and progress reporting.

**Audit (read and fix only if behaviour is wrong)**

14. Review every `status === 'ACTIVE'` check and `hasActiveEnrollment` usage, for example:
    - `libs/functions/src/utils/table/rows/formatRowsData.tsx`, lines 23 and 170
    - `libs/components/src/utils/tei/getRecentEnrollment.ts`, which picks the latest enrollment by `enrolledAt` and so is affected by R3
    - the admission page's enrollment status column (`enrollmentStatusColumn` in `modules/admission/src/pages/admission/admission.tsx`)

    Their results will change now that ACTIVE is meaningful. Confirm each screen shows the right learners.
15. Search the code for any remaining enrollment objects with a literal status (`grep -rn "status: \"COMPLETED\"\|status: 'COMPLETED'" src/modules src/libs`). Each one must be either an event status or go through the helper.

The Android app (`dhis2-emis-unima-android`) creates events only, at the selected school, and treats only CANCELLED as inactive. Do not change it. Verify it in the tests below.

## 5. DHIS2 metadata

Do not change metadata on any server yourself. Write the required settings into the PR description, for both the Student and Staff programs:

- Only enroll once: off (`onlyEnrollOnce = false`).
- Allow future enrollment dates: on (`selectEnrollmentDatesInFuture = true`).
- Allow future incident dates: on (`selectIncidentDatesInFuture = true`).

These let promotion create next year's enrollment before that year starts. Without them the tracker rejects the payload with E1020 or E1021.

Also:

- Show incident date: on, with the label "Academic year start".

## 6. Data migration script

Create `scripts/migrate-enrollment-lifecycle/` in the core repository.

**Technology.** Node 20+ and TypeScript run with `tsx`, using `fetch` only. Reuse the helper module. Do not add other runtime dependencies.

**Access.**
- Configuration: `DHIS2_BASE_URL` and `DHIS2_TOKEN`, sent as `Authorization: ApiToken <token>`.
- Never write credentials to disk or logs.

**Options.**
- `--dry-run` (default): tracker `importMode=VALIDATE`.
- `--commit`: apply the changes.
- `--program student|staff|all`.
- `--org-unit <uid>`: limit to one district or school.
- `--restore-transfer-history`: optional step, see below.

**Steps, for each tracked entity in the program:**

1. Read `semis/values` and `semis/schoolCalendar`.
2. Page through tracked entities, 100 per page, with their enrollments and events.
3. Work out each enrollment's academic year from its registration event.
4. Set the target status:
   - Final decision in `dropoutStatusValues`: CANCELLED.
   - Any other final decision: COMPLETED.
   - No final decision:
     - the learner's latest year (current or future): ACTIVE;
     - any earlier year: COMPLETED (report as "closed without final result").
   - Admission-only enrollment (no registration event): ACTIVE if it is the learner's only enrollment, otherwise COMPLETED (report it; never delete).
   - Existing CANCELLED with no final decision: keep.
   - Never more than one ACTIVE; the latest year wins.
5. Set `occurredAt` to the academic year start. Keep `enrolledAt`, unless it falls outside the year's start and end dates, in which case set it to the start. If the year is not in the calendar, change nothing and report it.
6. With `--restore-transfer-history`, for each Approved transfer event: move back to the transfer event's org unit (the origin) every event in the same enrollment that
   - has data values,
   - is not a registration or transfer event,
   - has `occurredAt` before the transfer event's `occurredAt`, and
   - is currently at the destination school.
7. Send all enrollment updates for one tracked entity in a single payload, so closing and activating are validated together. Send event org unit changes as a separate events payload. Use `importStrategy=UPDATE` and `atomicMode=OBJECT`.
8. Write a CSV report with one row per change: tracked entity, enrollment or event, field, old value, new value, reason, result. Also print a summary.

Add a README covering: run on a copy of production first, take a database backup before `--commit`, and run in this order: dry run, review report, commit on test server, verify, commit on production.

## 7. Tests

**Unit tests.** The 13 ported helper cases, plus tests for:

- the new payload builders in items 3, 5, 7, 8, 10 and 12;
- `formatRowsData` returning the registration event's org unit.

**Manual scenarios.** Run these on the development server (`npm run start`, which proxies to the server set in `package.json`) and record the result of each in the PR:

1. Admit a learner: one ACTIVE enrollment, no events.
2. Enroll that learner for the current year from the Admission list: the same enrollment is reused, it has a registration event, `occurredAt` is the year start, and the status is ACTIVE.
3. Try to enroll the same learner for the same year again: blocked.
4. Back-capture a past year: a separate COMPLETED enrollment is created; the current ACTIVE one is unchanged.
5. Final result "Promoted": COMPLETED; `enrolledAt` and `occurredAt` unchanged.
6. Final result "Dropout": CANCELLED; the row shows Dropout and attendance is disabled.
7. Promote: a new ACTIVE enrollment dated to next year's start, including when promotion runs before that year begins.
8. Staff carry-forward: same result as scenario 7.
9. Request and approve a transfer mid-year:
   - ownership moves;
   - the registration event and empty events move to the destination;
   - earlier attendance and marks stay at the origin;
   - enrollment status, dates and org unit are unchanged;
   - the learner appears in the destination's lists and not the origin's;
   - new attendance and marks at the destination are saved with the destination org unit.
10. Reject a transfer: only the transfer event status changes.
11. Bulk import enrollments: the current year becomes ACTIVE and past years COMPLETED.
12. Bulk import final results including a dropout value: CANCELLED; dates unchanged.
13. Edit an enrollment: status and dates unchanged unless the date was edited.
14. Android (`dhis2-emis-unima-android`, branch `emis-unima-main`): after a sync, class lists, attendance and marks behave as before; learners who dropped out are shown inactive; a transferred learner appears at the receiving school.

## 8. Git workflow

- Each submodule is its own repository. In every submodule you change, create branch `fix/enrollment-lifecycle` from the currently checked-out commit and commit there. The branches tracked in `.gitmodules` are `develop` for most submodules and `preview` for `libs/types`.
- Then, in the core repository, create the same branch and commit the updated submodule pointers, the migration script and the documentation.
- Use clear commit messages. Do not push, open pull requests or force-push. I will review first.
- Draft a PR description for each repository covering: what changed, why, the metadata settings (section 5), and the test results.

## 9. Out of scope

- Changes to the Android app (verification only).
- The BAO analytics views in `analytics/` (they will be simplified afterwards).
- Changing list screens to query by program ownership instead of registration events.
- Choosing a new class at transfer approval (possible follow-up).
- Deleting any data.

## 10. Stop and ask before

- running the migration with `--commit` anywhere;
- changing DHIS2 metadata;
- pushing any branch;
- changing any behaviour not described here.

## Definition of done

- No enrollment payload sets a status except through the helper rules.
- `enrolledAt` and `occurredAt` change only on creation or an explicit date edit.
- Transfer approval no longer moves events that contain data.
- New events use the registration event's org unit.
- The bulk final-result import marks dropouts CANCELLED.
- `npm run build-unix` succeeds, `npm test` passes, and there are no new TypeScript errors.
- The migration dry run produces a report on the development server.
- All work is committed on `fix/enrollment-lifecycle` branches, not pushed, with PR descriptions drafted.
