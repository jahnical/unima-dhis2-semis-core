# Clean up learners with a mangled ID after a bulk import

A bulk admission import read long IDs typed as numbers (for example the LIN `20195001930001` in an
Excel "General" cell) as the displayed text `2.0195E+13`. Every learner got the same ID, the learners
(tracked entities) were created, and their enrollments were rejected with E1064 (non-unique attribute).
The importer is fixed (`restoreLongNumbers` in `dhis2-semis-functions`); this script removes the
learners the failed import left behind so the file can be imported again.

It finds tracked entities of the section's tracked entity type that

- have **no enrollment** in any program (the import created the person, then the enrollment, which
  carries the attributes, was rejected), or
- have an ID attribute in scientific notation (`2.0195E+13`, `2E13`, ...),

and deletes them. Nothing else is touched. Every learner is listed in a CSV report with the reason.
Always use `--created-after` (and preferably `--org-unit`): learners admitted earlier without an
enrollment would otherwise be selected too.

## Requirements

- Node 20 or later; the script runs with `tsx` (`npx tsx` downloads it) and uses only `fetch`.
- A personal access token for a user who can search and delete learners in the affected schools.
  Learners that already have enrollments or events also need the *Delete tracked entity instance and
  associated enrollments and events* authority.

The token is read from the environment and only sent in the `Authorization: ApiToken ...` header.

## Run

```sh
export DHIS2_BASE_URL=https://project.ccdev.org/emis
export DHIS2_TOKEN=d2pat_...

# 1. Dry run (default): lists the learners and validates the deletion, nothing is saved
npx tsx scripts/cleanup-bulk-import-ids/cleanup.ts --created-after 2026-10-01

# 2. Review the report (cleanup-report-*.csv): names, school, created date

# 3. Delete
npx tsx scripts/cleanup-bulk-import-ids/cleanup.ts --created-after 2026-10-01 --commit
```

Then import the corrected admission file again.

## Options

| Option | Meaning |
| --- | --- |
| `--dry-run` | List and validate only (`importMode=VALIDATE`). The default. |
| `--commit` | Delete the listed learners. |
| `--section student\|staff` | Section of `semis/values` (default `student`). |
| `--attribute <uid>` | ID attribute to check. Default: `admission.studentIdentifier` of the section (the LIN, `IemwobHLkQv`). |
| `--org-unit <uid>` | Only learners owned by this school or district and below. Default: the token user's search and capture org units. |
| `--created-after <date>` | Only learners created on or after this date (`YYYY-MM-DD`). Recommended, to limit the run to the failed import. |
| `--only no-enrollment\|scientific-id` | Apply only one of the two checks (default: both). |
| `--report <file>` | CSV report path (default `cleanup-report-<timestamp>.csv`). |

Exit code: 0 when everything validated or was deleted, 2 when the tracker rejected some deletions
(see the `result` column), 1 when the script stopped with an error.
