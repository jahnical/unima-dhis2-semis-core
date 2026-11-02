# SEMIS Learner Dashboard: Superset Setup

Companion to `semis_bao_views.sql`. The dashboard is delivered as a Superset import bundle,
`superset/semis_learner_dashboard.zip`: 54 charts on seven tabs, the filter bar and the colours. This guide covers
importing it, what it contains, and embedding it in DHIS2 through Super BI with organisation unit filtering.

The bundle was built for Superset 6.1 and tested by importing it into Superset 6.1 against the SEMIS views
(synthetic data), rendering every tab, and replaying every chart query as an embedded (guest) user, with and
without organisation unit filtering. Version 21 was also tested as an update imported over version 20.

## 1. Datasets

The dashboard uses four datasets, created by the Analytics Platform from the views (with the `_view` suffix). Every
one has an `OrgUnitHierarchyPath` column for row level security.

| Dataset | One row per | Used for |
|---|---|---|
| `semis_learner_year_view` | learner per academic year, at the school of registration | Enrolment, flow (promotion, repetition, dropout, completion), age for grade |
| `semis_cohort_view` | learner per year since admission | Cohort retention, survival and on-track rate |
| `semis_admissions_view` | admitted learner, at the admitting school | Admissions and learners admitted but not enrolled |
| `semis_transfers_view` | transfer per side (Outgoing at origin, Incoming at destination) | Transfers in and out, pending approvals |

Version 1.8 of the views added columns to `semis_learner_year_view` (ECD attendance, special needs, orphan status,
village, re-admission and the learner's attendance in the year) and `is_current_year` to `semis_cohort_view`. The charts read these columns through SQL expressions, so the datasets need no *Sync columns*.

The bundle contains the database and dataset definitions exactly as exported from the Analytics Platform Superset,
so the import attaches the charts to the existing connection and datasets and does not change them.

The import also creates one virtual dataset, `semis_cohort_intake`, for the Cohort filter and the Cohort flow
matrix. It is `semis_cohort_view` plus an `intake` column that names each Standard 1 intake by its admission year and
the standard it is due in this year (for example `2019-2020 (Std 8 this year)`, or `2018-2019 (finished)`), and a
saved metric, `intake_order`, that lists the intakes still in school first, highest standard first. The label is
worked out from the current year and the last standard in `semis_config`, so it moves on by itself each academic
year. The dataset keeps every column of the cohort view, including `OrgUnitHierarchyPath`. It replaces
`semis_cohort_matrix` from earlier versions, which can be deleted.

Version 21 adds a second virtual dataset, `semis_attendance_day` (`SELECT * FROM semis.semis_attendance_view`): one
row per school, day, standard and gender, with the number of learners recorded present, late, absent and on leave. It
has its own name so it cannot clash with a `semis_attendance_view` dataset the Analytics Platform may create.

## 2. Before importing

1. **Pipeline.** The DHIS2 pipeline loads the Student program (*Events and enrollments*), *Metadata* and *Data store*.
2. **Views.** The 19 views of version 1.8 exist in the `semis` schema, all logical (Materialized off in AP).
3. **Copies of the heavy views.** `semis-mat.sh` keeps hourly copies of the nine heavy views in ClickHouse
   (database `semis_mat`), rebuilt in order, and the AP views of those nine read the copies
   (`SELECT * FROM semis_mat.<name>`). See the header of `semis_bao_views.sql`. Upgrading from version 1.7:
   paste the new `semis_src_learner` and `semis_src_event` into AP, run `bash semis-mat.sh apply semis_bao_views.sql`,
   then create the two new AP views `semis_stg_attendance` and `semis_attendance` as `SELECT * FROM semis_mat.<name>`.
4. **Checks.** Run the checks in section 8.

The temporal columns (`academic_year_start_date`, `admission_date`, `admission_month`, `requested_at`,
`requested_date`) are already marked as temporal in the datasets.

## 3. Import

1. In Superset, open **Dashboards** and choose **Import dashboard** (the upload icon next to *+ Dashboard*).
2. Select `semis_learner_dashboard.zip` and choose **Import**. No password is needed: the existing database
   connection is reused.
3. Open **SEMIS Learners**. The Academic year filter selects the latest academic year and the Outcome year filter the
   latest year with known outcomes.

Superset's dashboard import overwrites an existing dashboard but never existing charts or datasets. So when a bundle
changes a chart or a dataset, that chart or dataset gets a new identifier and the import adds it as new. An updated
bundle is therefore imported over the existing dashboard, with nothing deleted first: confirm the overwrite. The
replaced versions stay in Superset, attached to no dashboard, and can be deleted later (version 20 replaced 11 charts
and the `semis_cohort_matrix` dataset; `semis_cohort_flow`, from an earlier version, is also unused). Version 21
changes no existing chart: it adds 20 charts and the `semis_attendance_day` dataset. The dashboard
keeps its identifier, so the embed ID and the Super BI configuration stay valid.

Each chart carries its own metric definitions (ad hoc SQL metrics) and its saved query, so the charts keep working if
the Analytics Platform recreates the datasets, and embedded users can load them.

## 4. Dashboard contents

**Every chart shows its formula** in a caption under it, except the two Cohort flow matrices, which explain
themselves. The captions are text boxes in the dashboard layout (`FORMULA` in `build_bundle.py`), not chart settings:
the layout is replaced on every import, so a corrected formula text reaches Superset without new chart copies. The
filters narrow both sides of every ratio.

Rates use only learner-years whose outcome is known (`is_closed = 1`) in completed academic years
(`is_current_year = 0`). The year in progress is left out until it ends, even when some outcomes, such as a dropout,
are already recorded, and learners awaiting re-enrolment are left out.

**Dropouts are shown in two parts.** *Confirmed dropouts* have a dropout final result. *Not re-enrolled* learners have
no registration in the following year once its first 60 days have passed. The second group includes learners whose
promotion was never recorded in SEMIS, so it should be checked before it is read as dropout. Keeping the two apart
prevents incomplete promotion from appearing as a dropout spike when the grace period ends.

### Tab 1: Overview

| Chart | Type | Shows |
|---|---|---|
| Learners enrolled | Big Number | Learner-years in the selection |
| New entrants | Big Number | Learners in their first SEMIS registration |
| Gender parity index | Big Number | Female learners per male learner |
| Cohort flow matrix | Matrix (Handlebars) | The intake due in the last standard this year, from its admission year to now (see Tab 3). Follows the **Cohort** filter |
| Awaiting re-enrolment | Big Number | Last year's learners not yet registered this year (the promotion backlog). All years |
| Confirmed dropout rate | Big Number with trendline | Last completed academic year, with the trend over completed years |
| Promotion rate | Big Number with trendline | As above |
| Transfers awaiting approval | Big Number | Incoming requests not yet decided |
| Enrolment by academic year | Stacked bar by gender | All years |
| Enrolment by standard | Bar by gender | |
| Enrolment by district | Horizontal bar | |

### Tab 2: Flow and dropout

Driven by the **Outcome year** filter (completed academic years): what happened to that year's learners in the following year.

| Chart | Type | Shows |
|---|---|---|
| Learner flow by standard | 100% stacked bar | Promoted, repeated, completed, dropped out, not re-enrolled, per standard |
| Grade transitions | Sankey | Standard this year to the outcome next year |
| Dropout and non re-enrolment by year | Line | Confirmed dropout rate and not re-enrolled rate. All completed years |
| Confirmed dropout rate by gender | Line | All completed years |
| Dropout reasons | Horizontal bar | Reasons recorded with dropout final results, by option name |
| Other dropout reasons, as written | Table | The text entered under "specify", with the number of learners |
| Dropout by age for grade | Stacked horizontal bar | Confirmed and not re-enrolled rates by age for grade |
| Dropout by district | Stacked horizontal bar | As above, by district |
| Schools with the highest dropout | Table | Schools with at least 20 learner-years with known outcomes |

### Tab 3: Cohorts

Learners admitted to Standard 1, grouped by admission year (the cohort) and followed year by year. Not affected by
the Academic year, Outcome year and Standard filters.

| Chart | Type | Shows |
|---|---|---|
| Cohort flow matrix | Matrix (Handlebars) | One intake, chosen by admission year with the **Cohort** filter (by default the intake due in Standard 8 this year), from its admission year to the current year: one column per academic year, one row per standard, each cell the number of the intake's learners registered in that standard that year. Green cells are on track (the expected standard for the years since admission, or higher); orange numbers are below the expected standard (after repeating, returning from an interruption, or registering after the admission year). A dash means no registration in that standard and year, not in itself a dropout or transfer |
| Cohort retention | Pivot table with colour scale | Share of each admission cohort still in school or completed, by years since admission |
| Survival curves | Line | The same as curves |
| On-track rate | Line | In the expected standard for the years since admission, or higher. After Standard 8, learners who completed it on time count as on track |
| Survival to Standard 5 and 8, and completion | Bar by admission cohort | Share of each Standard 1 intake that has reached Standard 5 (intakes admitted at least 4 years ago), Standard 8 (at least 7 years ago) or completed Standard 8 (at least 8 years ago), as at this year. Repeaters count once they get there, so the most recent intakes in each group look lower. Intakes admitted less than 4 years ago, or with fewer than 20 learners, are left out |
| Cohort status by years since admission | 100% stacked bar | In school (same or other school), completed, out of school, awaiting re-enrolment |

### Tab 4: Inclusion

Learners in the selected academic year, from the learner profile.

| Chart | Type | Shows |
|---|---|---|
| New entrants with ECD | Big Number | Share of new Standard 1 entrants who attended ECD, among those with ECD attendance recorded |
| Learners with special needs | Big Number | Learners with a special need or disability recorded |
| Orphans | Big Number | Maternal, paternal or double orphans |
| Re-admitted learners | Big Number | Registered after a dropout, or after an academic year with no registration |
| Learners with special needs by standard | Bar by gender | |
| Special needs by type | Horizontal bar | By option name |
| New entrants by ECD attendance | Stacked bar by gender | Yes, No, Not recorded |
| Orphans by type | Stacked bar by gender | |
| Re-admitted learners by standard | Bar by gender | |
| Enrolment by village | Table | Village and school, with female and male learners; searchable |

### Tab 5: Attendance

Daily attendance in the selected academic year. Present and Late count as attended; Absent and Leave as missed.

| Chart | Type | Shows |
|---|---|---|
| Attendance rate | Big Number | Learner-days present or late, of learner-days recorded |
| Chronically absent | Big Number | Share of learners with at least 20 days recorded who missed 10% or more |
| Chronically absent learners | Big Number | The number of them |
| Schools recording attendance | Big Number | Share of schools with attendance recorded for at least one learner |
| Attendance rate by week | Line by gender | |
| Attendance rate by standard | Bar by gender | |
| Attendance rate by district | Horizontal bar | |
| Attendance recording by school | Table | Learners, share with attendance recorded, average days recorded and attendance rate; schools recording the fewest learners first |
| Chronically absent learners | Table | Follow-up list: school, learner ID, standard, days recorded and missed, lowest attendance first |

### Tab 6: Admissions

| Chart | Type | Shows |
|---|---|---|
| Admissions by month | Stacked bar by gender | By recorded admission date |
| No admission date | Big Number | Admitted learners with no admission date recorded; their admission year comes from the first enrolment |
| Admissions by entry standard | Bar | Entry above Standard 1 means late entry or a transfer from outside SEMIS |
| Admission status | Horizontal bar | Enrolled in the admission year, later, or not enrolled |
| Admitted but not enrolled | Table | Follow-up list for schools |

### Tab 7: Transfers

| Chart | Type | Shows |
|---|---|---|
| Approved transfers in and out by district | Bar by direction | |
| Transfer requests by status | Bar | Approved, pending, rejected |
| Transfer reasons | Horizontal bar | Outgoing side only, so each transfer counts once |
| Pending transfers | Table | Requests awaiting the receiving school's decision, oldest first |

## 5. Filters

| Filter | Column | Applies to |
|---|---|---|
| Division, District, Zone, School | `level2_name` … `school_name` | All charts. Each list depends on the one above |
| Academic year | `academic_year_label` | Overview (except trend charts), Inclusion, Attendance, Admissions, Transfers. Required; defaults to the latest year |
| Outcome year | `academic_year_label`, completed years with known outcomes | Flow and dropout (except the two trend lines). Required; defaults to the last completed year |
| Cohort | `intake`: Standard 1 intakes by admission year, with the standard each is due in this year | The two Cohort flow matrices. Required; defaults to the intake due in the last standard (Standard 8) this year |
| Gender | `gender` | All charts |
| Standard | `grade` | Overview, Flow and dropout, Inclusion and Attendance |

Academic years are filtered on the label (for example `2026-2027`) because SEMIS year codes are the end year (`2027`).

Filter scope is defined by excluded charts, which Superset maps to the new chart IDs on import. (A filter's stored
chart list is not mapped on import, so the bundle leaves it for Superset to work out when the dashboard opens.)

**How the matrix is styled.** Superset removes styling from chart HTML, so the matrix template marks each cell by
type and the dashboard's own CSS (*Edit dashboard → … → Edit CSS*) colours it. The CSS selects the charts by their
title, so keep the title **Cohort flow matrix**. Opened on its own in Explore, the chart shows the same numbers without
colours. The same CSS turns the formula text boxes (layout IDs starting `MARKDOWN-f-`) into small grey captions.

## 6. Colours

The colours are set in the dashboard JSON metadata (`label_colors`), so each label keeps the same colour on every
chart: Female `#2a78d6`, Male `#eb6834`; Promoted `#2a78d6`, Repeated `#1baf7a`, Completed `#4a3aa7`,
Dropped out `#e34948`, Not re-enrolled `#eda100`, Awaiting re-enrolment `#c3c2b7`; Incoming `#1baf7a`,
Outgoing `#4a3aa7`; Approved `#0ca30c`, Pending `#fab219`, Rejected `#d03b3b`; Reached Standard 5 `#2a78d6`,
Reached Standard 8 `#1baf7a`, Standard 8 completed `#4a3aa7`.

## 7. Embedding in DHIS2 with organisation unit filtering

1. In Superset, open the dashboard, choose **… → Embed dashboard**, add the DHIS2 domain
   (`https://project.ccdev.org`) to the allowed domains, enable embedding and copy the embed ID.
2. In DHIS2, open the **Super BI** app, create a dashboard with a name and the embed ID, and enable
   **Row level security**.
3. Share the Super BI dashboard with the relevant DHIS2 user groups.
4. Log in to DHIS2 as a user assigned to one school and open the dashboard: every chart, including the Cohort flow
   matrix (which uses the `semis_cohort_intake` dataset) and the Attendance charts (`semis_attendance_day`), should
   show that school only.

With row level security on, Superset adds `"OrgUnitHierarchyPath" like '<user org unit path>%'` to every dataset. It
uses the data output and analysis org units assigned to the DHIS2 user. A head teacher assigned to one school sees
that school only, a district officer every school in the district, and a national user everything. The filters then
narrow the view within what the user may see.

## 8. Checks before go-live

Run these in Superset SQL Lab.

```sql
-- 1. Configuration read correctly: no empty UIDs, dropout values present, current year as expected
SELECT * FROM semis.semis_config_view;

-- 2. Learners per school and year: compare with the SEMIS Enrollment module
SELECT school_name, academic_year_label, count() AS learners
FROM semis.semis_learner_year_view
WHERE school_uid = '<school uid>' GROUP BY school_name, academic_year_label ORDER BY academic_year_label;

-- 3. Dropouts per school and year: compare with rows marked "Dropout" in Final result
SELECT academic_year_label, countIf(flow_status = 'Dropped out') AS confirmed_dropouts,
       countIf(flow_status = 'Not re-enrolled') AS not_re_enrolled,
       countIf(flow_status = 'Awaiting re-enrolment') AS awaiting
FROM semis.semis_learner_year_view WHERE school_uid = '<school uid>'
GROUP BY academic_year_label ORDER BY academic_year_label;

-- 4. Data quality
SELECT countIf(registrations_in_year > 1) AS duplicate_registrations,
       countIf(grade_num = 0)             AS standard_without_number,
       countIf(gender = 'Not recorded')   AS gender_not_recorded,
       countIf(age_at_start IS NULL)      AS date_of_birth_missing
FROM semis.semis_learner_year_view;
```

If `gender_not_recorded` or `date_of_birth_missing` is close to the row count, check the `"Gender"` and
`"Date of birth"` column names in `semis_src_learner`, or whether these attributes are captured.

```sql
-- 5. Version 1.8 profile fields and attendance (latest year)
SELECT countIf(attended_ecd = 'Not recorded') AS ecd_not_recorded, countIf(disability = 'Not recorded') AS sne_not_recorded,
       countIf(orphan_status = 'Not recorded') AS orphan_not_recorded, countIf(village = 'Not recorded') AS village_not_recorded,
       countIf(att_recorded_days > 0) AS with_attendance, count() AS learners
FROM semis.semis_learner_year_view WHERE is_current_year = 1;
SELECT attendance_stage_uid, attendance_present_codes, attendance_absent_codes FROM semis.semis_config_view;
```

If every learner shows *Not recorded* for one field, check its column name in `semis_src_learner` (`"ECD Education
Attendance"`, `"disability"`, `"orphan"`, `"Village"`). If `with_attendance` is 0 while schools take attendance, check
`attendance_stage_uid`.

## 9. Notes

- **Silent dropout is inferred.** A learner counts as "Not re-enrolled" only after the next academic year has been
  open for 60 days with no registration anywhere. Until then the learner shows as "Awaiting re-enrolment" and is left
  out of rates. The grace period is `silent_dropout_grace_days` in `semis_config`.
- **Flow is based on what happened, not only on the final decision.** Promoted and Repeated come from the standard in
  the next year's registration, since the Promote action can place a learner in any standard. The raw decision is
  kept in `final_decision`.
- **Transfers.** When a transfer is approved, SEMIS moves the registration (and events without data) to the receiving
  school; the enrollment and earlier attendance and marks stay at the sending school. The learner-year therefore
  appears at the receiving school, marked `transferred_in`. The admission and cohort views use the original admitting
  school.
- **Cohorts are admission years.** The cohort is the admission academic year attribute, else the year of the
  admission date (or the first enrolment), else the first registration year. A learner first registered after the
  admission year is counted in the admission year's cohort and shows as behind for those years.
- **Dropout reasons** are shown by their option name; the "specify" text is kept in `dropout_reason_other`.
- **Standard numbers** come from the digits in the standard option code ("Standard 3" becomes 3).
- **Re-admission.** A learner is re-admitted in a year when they were registered in an earlier year but either
  dropped out the year before or had no registration that year.
- **Chronic absenteeism** is 10% or more of recorded days missed (absent or on leave), counted only for learners with
  at least 20 days recorded. Both values are set in `semis_config` (`chronic_absence_share`, `chronic_absence_min_days`).
  Attendance rates cover only the days a school recorded, so check *Attendance recording by school* before comparing
  schools.
- **Village** is free text on the learner profile. Spacing and capitals are tidied, but different spellings of the
  same village count separately.
- **Special needs and orphans.** A learner has a special need when the disability value is not one of
  `no_disability_values` in `semis_config` (D0, None, No, No disability); an orphan when the orphan value is not one of
  `not_orphan_values` (No, None, Not orphan).
- **Staff** are not covered. The same approach applies using the staff section of `semis/values`.
- **Privacy.** The datasets hold learner UIDs, learner IDs, gender and age, but no names. The two follow-up tables show
  the learner ID only.

## 10. Rebuilding the bundle

`superset/build_bundle.py` generates the bundle. It needs a dataset export from Superset (the four datasets, exported
together) and `superset/query_contexts.json`, the saved chart queries:

```sh
unzip dataset_export_*.zip -d export
python3 analytics/superset/build_bundle.py export semis_learner_dashboard.zip analytics/superset/query_contexts.json
```

To change a formula caption, edit `FORMULA` and rebuild; no chart changes. The bundle's dataset export is the same four datasets; `build_bundle.py` adds `semis_cohort_intake` and
`semis_attendance_day` itself. The saved queries were generated by Superset 6.1. After changing a chart's definition, add the chart to `REV` in
`build_bundle.py` (so an import over an existing dashboard adds it as a new chart), import the bundle into a test
Superset, open the chart once in Explore and save it, so Superset regenerates its saved query, then rebuild.
