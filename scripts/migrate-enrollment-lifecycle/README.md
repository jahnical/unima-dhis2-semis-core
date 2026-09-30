# Enrollment lifecycle migration

Corrects existing SEMIS data so that it follows the enrollment rules used by the app since the
`fix/enrollment-lifecycle` change:

- one enrollment per person per academic year;
- `ACTIVE` for the latest (current or future) year, `COMPLETED` once a final result is recorded or the
  year is over, `CANCELLED` for a dropout;
- never more than one `ACTIVE` enrollment per person;
- `occurredAt` (incident date) is the start of the academic year from `semis/schoolCalendar`.

It never deletes anything. Every change and every finding is written to a CSV report.

## Requirements

- Node 20 or later. The script runs with `tsx` (`npx tsx` downloads it) and uses only `fetch`.
- A personal access token for a user who can read and write both programs everywhere (a
  superuser on a test server). Create it under *Profile > Personal access tokens*.
- The program settings listed in the PR description (future enrollment and incident dates allowed).
  Without them, enrollments for a future year are rejected with E1020 or E1021.

The token is read from the environment and sent only in the `Authorization: ApiToken ...` header. It
is never written to the report or printed.

## Run order

1. **Copy of production first.** Restore a recent production database on a test server and run
   everything there before touching production.
2. **Dry run** (the default; the tracker only validates, nothing is saved):

   ```sh
   export DHIS2_BASE_URL=https://test-server/dhis
   export DHIS2_TOKEN=d2pat_...
   npx tsx scripts/migrate-enrollment-lifecycle/migrate.ts --program all --restore-transfer-history
   ```

3. **Review the report.** Check the status transitions in the summary and the rows marked
   `REPORTED` (findings that change nothing) and `ERROR`. Fix configuration problems, such as
   missing academic years in the school calendar, and dry-run again.
4. **Commit on the test server:** take a database backup, then run the same command with
   `--commit`.
5. **Verify on the test server:** class lists, attendance, marks, final results, promotion and
   transfers (see the manual scenarios in the PR), and the Android app after a sync.
6. **Commit on production:** take a database backup of production, then run with `--commit`.
   Start with one district (`--org-unit <uid>`) if you want to check a smaller batch first.

## Options

| Option | Meaning |
| --- | --- |
| `--dry-run` | Validate only (`importMode=VALIDATE`). This is the default. |
| `--commit` | Save the changes. |
| `--program student\|staff\|all` | Which section of `semis/values` to process (default `all`). |
| `--org-unit <uid>` | Only tracked entities owned by this district or school and below. |
| `--restore-transfer-history` | Move events captured before an approved transfer back to the sending school (see below). |
| `--report <file>` | CSV report path (default `migration-report-<timestamp>.csv`). |

The exit code is 0 when everything validated or saved, 2 when the tracker rejected some changes, and
1 when the script stopped with an error.

## What it changes

For each tracked entity, 100 per page, with all its enrollments and events:

**Status.** The academic year of an enrollment comes from its registration event.

| Situation | Status |
| --- | --- |
| Final decision in `dropoutStatusValues` | `CANCELLED` |
| Any other final decision | `COMPLETED` |
| No final decision, the person's latest year, current or future | `ACTIVE` |
| No final decision, any earlier year | `COMPLETED` ("closed without final result") |
| No final decision, already `CANCELLED` | kept |
| Admission only (no registration event), the only enrollment | `ACTIVE` |
| Admission only, next to other enrollments | `COMPLETED` (reported, never deleted) |
| Academic year value not recognised | kept (reported) |

If two enrollments would be `ACTIVE` (for example two registrations in the same year), the one in
the latest year stays `ACTIVE`, preferring the one that is already `ACTIVE`, then the latest
enrollment date. The others become `COMPLETED` and are reported.

**Dates.** `occurredAt` becomes the start date of the enrollment's academic year. `enrolledAt` is kept
unless it falls outside that year's start and end dates, in which case it becomes the start date. If
the academic year is not in the school calendar, no date is changed and the enrollment is reported.

**Transfer history (optional).** Older transfer approvals moved every event of the enrollment to the
receiving school. For each approved transfer event, events of the same enrollment that have data, are
not registration or transfer events, happened before the transfer event's date and are now at the
receiving school, are moved back to the transfer event's org unit (the sending school).

Academic years are compared with the same ordering as the app (`yearOrder`): a plain code such as
`2026` is read through its option label or the school calendar as 2025/2026.

## How it is sent

Enrollment updates for a page go in one tracker payload, with each person's closings ahead of the
enrollment that becomes `ACTIVE`, so DHIS2 validates them together (rule E1015). Event moves go in a
separate events payload. Both use `importStrategy=UPDATE` and `atomicMode=OBJECT`, so a rejected
object does not block the others; its error code is in the report.

## Report

One row per change or finding:

`tracked_entity, object (enrollment|event), id, field, old_value, new_value, reason, result`

`result` is `VALID` (dry run), `UPDATED` (commit), `ERROR <code>: <message>`, or `REPORTED` for
findings that change nothing.

## Tests

The planning rules are in `plan.ts` and tested by `plan.test.ts` (`npm test`).
