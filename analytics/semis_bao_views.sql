-- =============================================================================
-- SEMIS learner analytics views for the BAO Analytics Platform (ClickHouse)
-- Used by Superset and embedded in DHIS2 through Super BI.
--
-- Version  : 1.8 (5 October 2026) - ECD, special needs, orphans, village, re-admission,
--            attendance and survival indicators (1.7: cohorts by admission year,
--            dropout reason names, admission date as recorded)
-- Owner    : Mathews Jere, SEMIS Project Lead, University of Malawi
-- Source   : DHIS2 2.41+ loaded by the AP DHIS2 data pipeline into schema
--            "emis" (wide tracker tables, data store, options)
--
-- HOW TO USE
--   Create each block below as a view in AP (Views > New view), in the order
--   given, using the view name in the "@view" line. Paste only the SELECT.
--   AP creates a Superset dataset for each view automatically.
--
--   Create the views in the "semis" schema. AP adds "_view" to each view
--   name, so the view entered as semis_config is stored as
--   semis.semis_config_view, and the views refer to each other by those
--   names. They read the pipeline tables from the "emis" schema. If you use
--   another schema for the views, replace "semis.semis_" throughout.
--
--   Layer 1 (semis_src_*) is mapped to the "emis" pipeline tables. The only
--   values to review are the constants marked "SET" in semis_config.
--
--   Keep every view logical in AP (Materialized off). AP refreshes all of its
--   materialised views at the same moment, so a view can be rebuilt while a
--   view it reads is still empty. Instead, semis-mat.sh keeps hourly copies of
--   the nine heavy views in ClickHouse (database "semis_mat"), each rebuilt
--   only after the copies it reads, and the AP views of those nine read the
--   copies:
--     semis_config, semis_option_lookup, semis_stg_transfer,
--     semis_stg_attendance, semis_stg_registration, semis_learner,
--     semis_learner_year, semis_cohort, semis_attendance.
--   To change one of those nine, edit it in this file and run
--     bash semis-mat.sh apply semis_bao_views.sql
--   Change the other views in AP as before.
--
--   Upgrading from 1.7: (1) in AP, replace semis_src_learner and
--   semis_src_event with the versions below; (2) run
--     bash semis-mat.sh apply semis_bao_views.sql
--   (3) in AP, create the two new views semis_stg_attendance and
--   semis_attendance, each as SELECT * FROM semis_mat.<name> (the script
--   lists them when it finishes); (4) import dashboard bundle v21.
--
--   Version 1.8 tested on ClickHouse 26.9 (earlier versions also on 23.10).
--
-- HOW SEMIS STORES LEARNER DATA (from the SEMIS 2.0.10 source code)
--   * Admission creates the learner (tracked entity) and an ACTIVE enrollment
--     at the school with no events. The admission date, admission academic
--     year and learner ID are attributes (semis/values > student > admission).
--   * Each academic year is a separate DHIS2 enrollment holding one
--     "registration" event: academic year, standard (grade) and class.
--   * Final result: one event per enrollment with the "Final decision". A value
--     listed in dropoutStatusValues marks the enrollment CANCELLED (dropout);
--     any other value marks it COMPLETED.
--   * Promotion creates the next year's enrollment and registration event.
--   * Transfer: a transfer event (Pending/Approved/Rejected) stays at the
--     origin school. On approval, ownership moves and the enrollment and its
--     events are moved to the destination school.
--
-- DEFINITIONS USED BY THESE VIEWS
--   Learner-year       One learner in one academic year (latest registration
--                      if a learner has more than one in the same year).
--   Explicit dropout   Final decision in dropoutStatusValues, or enrollment
--                      status CANCELLED.
--   Not re-enrolled    Year closed, no registration in the following year
--                      anywhere, no dropout recorded and not completed. This
--                      is "silent" dropout. It is counted only after the
--                      following year has been open for the grace period
--                      (default 60 days).
--   Flow status        What happened next, from the actual next-year
--                      registration: Promoted, Repeated, Completed,
--                      Dropped out, Not re-enrolled, In progress,
--                      Awaiting re-enrolment.
--   Cohort             Learners admitted in the same academic year: the
--                      admission academic year attribute, else the year of
--                      the admission date (or first enrolment), else the
--                      first registration year. Entry standard = standard
--                      of the first registration.
--
-- ORG UNIT FILTERING
--   Every dashboard view has an "OrgUnitHierarchyPath" column: the DHIS2
--   path of the school (for example /ImspTQPwCqd/.../qjboFI0irVu). With row
--   level security enabled in Super BI, Superset filters every dataset to
--   the org units assigned to the DHIS2 user. The level1_name to
--   level4_name and school_name columns are used for Superset native filters.
-- =============================================================================


-- =============================================================================
-- LAYER 1  SOURCE ADAPTER
-- The only views that read AP pipeline tables (schema "emis"). Table and
-- column names are taken from the AP schema export of 30 September 2026.
-- Column names are PascalCase or data element names, so they are
-- double-quoted. Keep the output column names (after AS) unchanged.
--
-- The pipeline stores tracker data as wide tables: one row per event with
-- one column per data element ("emis.student_event"), and one row per
-- enrollment with one column per attribute ("emis.student"). If a data
-- element or attribute is renamed in DHIS2, its column name changes here.
-- =============================================================================

-- @view semis_src_orgunit
-- One row per organisation unit.
SELECT
    ifNull(toString("ID"), '')                  AS ou_uid,
    ifNull(toString("Name"), '')                AS ou_name,
    ifNull(toString("Code"), '')                AS ou_code,
    toUInt8(ifNull("HierarchyLevel", 0))        AS ou_level,
    ifNull(toString("Path"), '')                AS ou_path          -- /uid1/uid2/.../uidN
FROM emis.orgunit;


-- @view semis_src_datastore
-- DHIS2 data store entries.
SELECT
    ifNull(toString("Namespace"), '')           AS ds_namespace,
    ifNull(toString("NamespaceKey"), '')        AS ds_key,
    ifNull(toString("Value"), '')               AS ds_value         -- JSON text
FROM emis.datastore;


-- @view semis_src_option
-- Option codes and names, used to match values stored as either.
SELECT
    ifNull(toString("OptionSetID"), '')         AS optionset_uid,
    ifNull(toString("Code"), '')                AS option_code,
    ifNull(toString("Name"), '')                AS option_name
FROM emis.option;


-- @view semis_src_enrollment
-- Enrollments of all tracker programs.
SELECT
    ifNull(toString("EnrollmentID"), '')                         AS enrollment_uid,
    ifNull(toString("TrackedEntityInstanceID"), '')              AS tei_uid,
    ifNull(toString("ProgramID"), '')                            AS program_uid,
    ifNull(toString("OrgUnitID"), '')                            AS ou_uid,
    parseDateTimeBestEffortOrNull(toString("EnrollmentDate"))    AS enrolled_at,
    upper(ifNull(toString("Status"), ''))                        AS enrollment_status,  -- ACTIVE / COMPLETED / CANCELLED
    toUInt8(ifNull("Deleted", 0))                                AS is_deleted
FROM emis.enrollment;


-- @view semis_src_learner
-- Learner attributes from the Student program enrollment table
-- ("Student - Enrollment"), one row per enrollment.
SELECT
    ifNull(toString("TrackedEntityID"), '')                          AS tei_uid,
    ifNull(toString("EnrollmentID"), '')                             AS enrollment_uid,
    ifNull(toString("Gender"), '')                                   AS gender_raw,
    parseDateTimeBestEffortOrNull(toString("Date of birth"))         AS date_of_birth,
    parseDateTimeBestEffortOrNull(toString("Admission Date"))        AS admission_date,
    ifNull(toString("Admission academic year"), '')                  AS admission_year_raw,
    ifNull(toString("LIN"), '')                                      AS learner_id,      -- learner identification number
    ifNull(toString("ECD Education Attendance"), '')                 AS ecd_raw,         -- attended ECD (true/false)
    ifNull(toString("disability"), '')                               AS disability_raw,  -- disability type (option)
    ifNull(toString("orphan"), '')                                   AS orphan_raw,      -- orphanhood (option)
    ifNull(toString("Village"), '')                                  AS village_raw,
    toUInt8(ifNull("Deleted", 0))                                    AS is_deleted
FROM emis.student;


-- @view semis_src_event
-- Student program events ("Student - Tracker event") with the data elements
-- SEMIS analytics uses. The table has no tracked entity column, so it is
-- taken from the enrollment.
SELECT
    ifNull(toString(e."EventID"), '')                            AS event_uid,
    ifNull(toString(e."EnrollmentID"), '')                       AS enrollment_uid,
    ifNull(en.en_tei, '')                                        AS tei_uid,
    ifNull(toString(e."ProgramStageID"), '')                     AS stage_uid,
    ifNull(toString(e."OrgUnitID"), '')                          AS ou_uid,
    parseDateTimeBestEffortOrNull(toString(e."EventDate"))       AS occurred_at,
    upper(ifNull(toString(e."EventStatus"), ''))                 AS event_status,
    toUInt8(ifNull(e."Deleted", 0))                              AS is_deleted,
    -- Registration stage
    ifNull(toString(e."Academic Year_Package"), '')              AS academic_year,
    ifNull(toString(e."Grade"), '')                              AS grade,
    ifNull(toString(e."Class/Section"), '')                      AS class_section,
    -- Final result stage
    ifNull(toString(e."Final decision"), '')                     AS final_decision,
    ifNull(toString(e."Reasons for School Dropout"), '')         AS dropout_reason,
    ifNull(toString(e."Reasons for School Dropout-specify"), '') AS dropout_reason_other,
    -- Transfer stage
    ifNull(toString(e."Transfer status"), '')                    AS transfer_status_value,
    ifNull(toString(e."Destiny School"), '')                     AS transfer_destination_value,
    ifNull(toString(e."Reason for transfer"), '')                AS transfer_reason,
    -- Attendance stage
    ifNull(toString(e."Attendance"), '')                         AS attendance_value,
    ifNull(toString(e."Reason of absence"), '')                  AS absence_reason
FROM emis.student_event AS e
LEFT JOIN
(
    SELECT toString("EnrollmentID") AS en_enrollment, any(toString("TrackedEntityInstanceID")) AS en_tei
    FROM emis.enrollment
    GROUP BY en_enrollment
) AS en ON en.en_enrollment = e."EnrollmentID"
SETTINGS join_use_nulls = 0;


-- =============================================================================
-- LAYER 2  CONFIGURATION
-- Reads the SEMIS configuration from the DHIS2 data store, so the views use
-- the same programs, stages, data elements and dropout values as the app.
-- Changes made in the SEMIS Configurations module apply here automatically.
-- =============================================================================

-- @view semis_calendar
-- One row per academic year defined in the SEMIS school calendar
-- (semis/schoolCalendar). year_start is the year number in the code (for
-- example 2027 for code "2027", labelled "2026-2027"); it is used to order
-- years and find the following year.
SELECT
    JSONExtractString(y, 'academicYear', 'code')                                        AS academic_year,
    coalesce(nullIf(JSONExtractString(y, 'academicYear', 'label'), ''), academic_year)  AS academic_year_label,
    toDate(parseDateTimeBestEffortOrNull(JSONExtractString(y, 'academicYear', 'startDate'))) AS start_date,
    toDate(parseDateTimeBestEffortOrNull(JSONExtractString(y, 'academicYear', 'endDate')))   AS end_date,
    if(toInt32OrZero(substring(academic_year, 1, 4)) > 1900,
       toInt32OrZero(substring(academic_year, 1, 4)),
       toInt32(ifNull(toYear(start_date), 0)))                                          AS year_start
FROM
(
    SELECT arrayJoin(JSONExtractArrayRaw(ds_value, 'schoolCalendar')) AS y
    FROM semis.semis_src_datastore_view
    WHERE ds_namespace = 'semis' AND ds_key = 'schoolCalendar'
)
WHERE academic_year != '';


-- @view semis_config
-- One row with the SEMIS settings the other views use.
-- Settings come from the semis/values data store key when the pipeline has
-- loaded it. Each one that is missing is detected from the data instead: the
-- stage whose events carry the academic year and standard is the
-- registration stage, the one carrying "Final decision" is the final result
-- stage, and the one carrying "Transfer status" is the transfer stage.
-- settings_source shows which applied. The current academic year is the
-- latest one in the school calendar that has started.
SELECT
    if(s != '', 'semis/values', 'detected from data')                     AS settings_source,
    coalesce(nullIf(JSONExtractString(s, 'program'), ''),
        (SELECT argMax(program_uid, n) FROM
            (SELECT program_uid, count() AS n FROM semis.semis_src_enrollment_view
             WHERE enrollment_uid IN (SELECT enrollment_uid FROM semis.semis_src_event_view)
             GROUP BY program_uid)))                                       AS program_uid,
    coalesce(nullIf(JSONExtractString(s, 'registration', 'programStage'), ''),
        (SELECT argMax(stage_uid, n) FROM
            (SELECT stage_uid, countIf(academic_year != '' AND grade != '') AS n
             FROM semis.semis_src_event_view GROUP BY stage_uid) WHERE n > 0)) AS registration_stage_uid,
    coalesce(nullIf(JSONExtractString(s, 'final-result', 'programStage'), ''),
        (SELECT argMax(stage_uid, n) FROM
            (SELECT stage_uid, countIf(final_decision != '') AS n
             FROM semis.semis_src_event_view GROUP BY stage_uid) WHERE n > 0)) AS final_result_stage_uid,
    coalesce(nullIf(JSONExtractString(s, 'transfer', 'programStage'), ''),
        (SELECT argMax(stage_uid, n) FROM
            (SELECT stage_uid, countIf(transfer_status_value != '') AS n
             FROM semis.semis_src_event_view GROUP BY stage_uid) WHERE n > 0)) AS transfer_stage_uid,
    coalesce(nullIf(JSONExtractString(s, 'attendance', 'programStage'), ''),
        (SELECT argMax(stage_uid, n) FROM
            (SELECT stage_uid, countIf(attendance_value != '' AND academic_year = '') AS n
             FROM semis.semis_src_event_view GROUP BY stage_uid) WHERE n > 0)) AS attendance_stage_uid,
    -- Attendance status codes (Configurations > Attendance). When none are set, values
    -- containing "present", "late", "absent" or "leave" are used.
    arrayFilter(x -> x != '', [JSONExtractString(arrayFirst(o -> JSONExtractString(o, 'configKey') = 'presentCode',
                                   JSONExtractArrayRaw(s, 'attendance', 'statusOptions')), 'code'),
                               JSONExtractString(s, 'attendance', 'presentCode')]) AS attendance_present_codes,
    arrayFilter(x -> x != '', [JSONExtractString(arrayFirst(o -> JSONExtractString(o, 'configKey') = 'lateCode',
                                   JSONExtractArrayRaw(s, 'attendance', 'statusOptions')), 'code'),
                               JSONExtractString(s, 'attendance', 'lateCode')])    AS attendance_late_codes,
    arrayFilter(x -> x != '', [JSONExtractString(arrayFirst(o -> JSONExtractString(o, 'configKey') = 'absentCode',
                                   JSONExtractArrayRaw(s, 'attendance', 'statusOptions')), 'code'),
                               JSONExtractString(s, 'attendance', 'absentCode')])  AS attendance_absent_codes,
    arrayFilter(x -> x != '', [JSONExtractString(arrayFirst(o -> JSONExtractString(o, 'configKey') = 'leaveCode',
                                   JSONExtractArrayRaw(s, 'attendance', 'statusOptions')), 'code'),
                               JSONExtractString(s, 'attendance', 'leaveCode')])   AS attendance_leave_codes,

    -- SET: the defaults after the comma apply only when semis/values is not
    -- loaded. They must match the SEMIS configuration (Configurations >
    -- Final result and Transfer). Option codes or option names both work.
    if(notEmpty(JSONExtract(s, 'final-result', 'validStatusValue', 'Array(String)')),
       JSONExtract(s, 'final-result', 'validStatusValue', 'Array(String)'),
       ['Promoted'])                                                       AS promotable_values,
    if(notEmpty(JSONExtract(s, 'final-result', 'dropoutStatusValues', 'Array(String)')),
       JSONExtract(s, 'final-result', 'dropoutStatusValues', 'Array(String)'),
       ['Dropout'])                                                        AS dropout_values,
    coalesce(nullIf(JSONExtractString(arrayFirst(o -> JSONExtractString(o, 'configKey') = 'approvedCode'
                                                   OR JSONExtractString(o, 'key') = 'approved',
                                                 JSONExtractArrayRaw(s, 'transfer', 'statusOptions')), 'code'), ''),
             'Approved')                                                   AS transfer_approved_code,
    coalesce(nullIf(JSONExtractString(arrayFirst(o -> JSONExtractString(o, 'configKey') = 'reprovedCode'
                                                   OR JSONExtractString(o, 'key') = 'reproved',
                                                 JSONExtractArrayRaw(s, 'transfer', 'statusOptions')), 'code'), ''),
             'Reproved')                                                   AS transfer_rejected_code,

    coalesce(
        nullIf((SELECT argMax(academic_year, start_date) FROM semis.semis_calendar_view
                WHERE start_date IS NOT NULL AND start_date <= today()), ''),
        nullIf(JSONExtractString(cal, 'defaults', 'academicYear'), ''),
        nullIf(JSONExtractString(s, 'defaults', 'currentAcademicYear'), ''),
        toString(toYear(today())))                                         AS current_academic_year,
    if(ifNull((SELECT argMax(year_start, start_date) FROM semis.semis_calendar_view
               WHERE start_date IS NOT NULL AND start_date <= today()), 0) > 0,
       ifNull((SELECT argMax(year_start, start_date) FROM semis.semis_calendar_view
               WHERE start_date IS NOT NULL AND start_date <= today()), 0),
       toInt32OrZero(substring(current_academic_year, 1, 4)))             AS current_year_start,

    -- SET: values that are not part of the SEMIS configuration.
    toInt32(6)                                                             AS official_entry_age,   -- official age at Standard 1
    toInt32(8)                                                             AS final_grade_num,      -- last standard of the cycle
    toInt32(60)                                                            AS silent_dropout_grace_days,
    toFloat64(0.10)                                                        AS chronic_absence_share,     -- absent (any reason) this share of recorded days or more
    toInt32(20)                                                            AS chronic_absence_min_days,  -- days recorded before a learner is judged
    ['d0', 'none', 'no', 'no disability']                                  AS no_disability_values,      -- disability codes or names meaning none
    ['no', 'none', 'not orphan']                                           AS not_orphan_values          -- orphanhood codes or names meaning not an orphan
FROM
(
    SELECT
        -- semis/values is a JSON list; also accept it stored as a JSON string.
        arrayFirst(x -> JSONExtractString(x, 'key') = 'student',
                   if(JSONType(v) = 'String', JSONExtractArrayRaw(JSONExtractString(v)), JSONExtractArrayRaw(v))) AS s,
        cal
    FROM
    (
        SELECT anyIf(ds_value, ds_key = 'values')         AS v,
               anyIf(ds_value, ds_key = 'schoolCalendar') AS cal
        FROM semis.semis_src_datastore_view
        WHERE ds_namespace = 'semis'
    )
);


-- @view semis_orgunit
-- Every org unit with its path (OrgUnitHierarchyPath) and ancestor names.
-- In Malawi: level 1 country, 2 division, 3 district, 4 zone, 5 school.
-- Rename the columns in Superset if your hierarchy differs.
SELECT
    b.ou_uid                    AS ou_uid,
    b.ou_name                   AS ou_name,
    b.ou_code                   AS ou_code,
    b.ou_level                  AS ou_level,
    b.ou_path                   AS OrgUnitHierarchyPath,
    ifNull(n1.name1, '')        AS level1_name,
    ifNull(n2.name2, '')        AS level2_name,
    ifNull(n3.name3, '')        AS level3_name,
    ifNull(n4.name4, '')        AS level4_name,
    ifNull(n5.name5, '')        AS level5_name,
    b.l2                        AS level2_uid,
    b.l3                        AS level3_uid,
    b.l4                        AS level4_uid
FROM
(
    SELECT
        ou_uid, ou_name, ou_code, ou_level, ou_path,
        splitByChar('/', trim(BOTH '/' FROM ou_path)) AS parts,
        parts[1] AS l1, parts[2] AS l2, parts[3] AS l3, parts[4] AS l4, parts[5] AS l5
    FROM semis.semis_src_orgunit_view
) AS b
LEFT JOIN (SELECT ou_uid AS u1, ou_name AS name1 FROM semis.semis_src_orgunit_view) AS n1 ON n1.u1 = b.l1
LEFT JOIN (SELECT ou_uid AS u2, ou_name AS name2 FROM semis.semis_src_orgunit_view) AS n2 ON n2.u2 = b.l2
LEFT JOIN (SELECT ou_uid AS u3, ou_name AS name3 FROM semis.semis_src_orgunit_view) AS n3 ON n3.u3 = b.l3
LEFT JOIN (SELECT ou_uid AS u4, ou_name AS name4 FROM semis.semis_src_orgunit_view) AS n4 ON n4.u4 = b.l4
LEFT JOIN (SELECT ou_uid AS u5, ou_name AS name5 FROM semis.semis_src_orgunit_view) AS n5 ON n5.u5 = b.l5
SETTINGS join_use_nulls = 0;


-- @view semis_option_lookup
-- Maps final result, transfer status, dropout reason, attendance, disability
-- and orphanhood values to their option codes and names, whether the pipeline stores the option code or the
-- option name. The option set is the one that best matches the values found
-- in the events, then the values set in semis_config.
WITH
    fr_values AS (SELECT groupUniqArray(lower(final_decision)) AS v
                  FROM semis.semis_src_event_view WHERE final_decision != ''),
    tr_values AS (SELECT groupUniqArray(lower(transfer_status_value)) AS v
                  FROM semis.semis_src_event_view WHERE transfer_status_value != ''),
    dr_values AS (SELECT groupUniqArray(lower(dropout_reason)) AS v
                  FROM semis.semis_src_event_view WHERE dropout_reason != ''),
    at_values AS (SELECT groupUniqArray(lower(attendance_value)) AS v
                  FROM semis.semis_src_event_view WHERE attendance_value != ''),
    ds_values AS (SELECT groupUniqArray(lower(disability_raw)) AS v
                  FROM semis.semis_src_learner_view WHERE disability_raw != ''),
    or_values AS (SELECT groupUniqArray(lower(orphan_raw)) AS v
                  FROM semis.semis_src_learner_view WHERE orphan_raw != ''),
    fr_cfg    AS (SELECT arrayMap(x -> lower(x), arrayConcat(dropout_values, promotable_values)) AS v
                  FROM semis.semis_config_view),
    tr_cfg    AS (SELECT [lower(transfer_approved_code), lower(transfer_rejected_code), 'pending'] AS v
                  FROM semis.semis_config_view),
    set_scores AS
    (
        SELECT
            optionset_uid,
            countIf(has((SELECT v FROM fr_values), lower(option_code)) OR has((SELECT v FROM fr_values), lower(option_name))) AS fr_data,
            countIf(has((SELECT v FROM fr_cfg),    lower(option_code)) OR has((SELECT v FROM fr_cfg),    lower(option_name))) AS fr_conf,
            countIf(has((SELECT v FROM tr_values), lower(option_code)) OR has((SELECT v FROM tr_values), lower(option_name))) AS tr_data,
            countIf(has((SELECT v FROM tr_cfg),    lower(option_code)) OR has((SELECT v FROM tr_cfg),    lower(option_name))) AS tr_conf,
            countIf(has((SELECT v FROM dr_values), lower(option_code)) OR has((SELECT v FROM dr_values), lower(option_name))) AS dr_data,
            countIf(has((SELECT v FROM at_values), lower(option_code)) OR has((SELECT v FROM at_values), lower(option_name))) AS at_data,
            countIf(has((SELECT v FROM ds_values), lower(option_code)) OR has((SELECT v FROM ds_values), lower(option_name))) AS ds_data,
            countIf(has((SELECT v FROM or_values), lower(option_code)) OR has((SELECT v FROM or_values), lower(option_name))) AS or_data
        FROM semis.semis_src_option_view
        WHERE optionset_uid != ''
        GROUP BY optionset_uid
    ),
    best AS
    (
        SELECT
            argMaxIf(optionset_uid, fr_data * 100 + fr_conf, fr_data + fr_conf > 0) AS fr_set,
            argMaxIf(optionset_uid, tr_data * 100 + tr_conf, tr_data + tr_conf > 0) AS tr_set,
            argMaxIf(optionset_uid, dr_data, dr_data > 0)                           AS dr_set,
            argMaxIf(optionset_uid, at_data, at_data > 0)                           AS at_set,
            argMaxIf(optionset_uid, ds_data, ds_data > 0)                           AS ds_set,
            argMaxIf(optionset_uid, or_data, or_data > 0)                           AS or_set
        FROM set_scores
    )
SELECT domain, option_key, any(option_code) AS option_code, any(option_name) AS option_name
FROM
(
    SELECT 'final_result' AS domain, option_code, option_name, arrayJoin([lower(option_code), lower(option_name)]) AS option_key
    FROM semis.semis_src_option_view
    WHERE optionset_uid != '' AND optionset_uid = (SELECT fr_set FROM best)
    UNION ALL
    SELECT 'transfer_status' AS domain, option_code, option_name, arrayJoin([lower(option_code), lower(option_name)]) AS option_key
    FROM semis.semis_src_option_view
    WHERE optionset_uid != '' AND optionset_uid = (SELECT tr_set FROM best)
    UNION ALL
    SELECT 'dropout_reason' AS domain, option_code, option_name, arrayJoin([lower(option_code), lower(option_name)]) AS option_key
    FROM semis.semis_src_option_view
    WHERE optionset_uid != '' AND optionset_uid = (SELECT dr_set FROM best)
    UNION ALL
    SELECT 'attendance' AS domain, option_code, option_name, arrayJoin([lower(option_code), lower(option_name)]) AS option_key
    FROM semis.semis_src_option_view
    WHERE optionset_uid != '' AND optionset_uid = (SELECT at_set FROM best)
    UNION ALL
    SELECT 'disability' AS domain, option_code, option_name, arrayJoin([lower(option_code), lower(option_name)]) AS option_key
    FROM semis.semis_src_option_view
    WHERE optionset_uid != '' AND optionset_uid = (SELECT ds_set FROM best)
    UNION ALL
    SELECT 'orphan' AS domain, option_code, option_name, arrayJoin([lower(option_code), lower(option_name)]) AS option_key
    FROM semis.semis_src_option_view
    WHERE optionset_uid != '' AND optionset_uid = (SELECT or_set FROM best)
)
WHERE option_key != ''
GROUP BY domain, option_key;


-- =============================================================================
-- LAYER 3  STAGING
-- =============================================================================

-- @view semis_stg_transfer
-- One row per transfer request (Student program transfer stage).
WITH
    tr AS
    (
        SELECT event_uid, enrollment_uid, tei_uid, ou_uid, occurred_at,
               lower(transfer_status_value) AS st_key, transfer_status_value AS st_raw,
               transfer_destination_value AS dest_raw, transfer_reason AS reason_raw
        FROM semis.semis_src_event_view
        WHERE stage_uid = (SELECT transfer_stage_uid FROM semis.semis_config_view)
          AND is_deleted = 0
    ),
    st AS
    (
        SELECT option_key AS st_k, option_code AS st_code
        FROM semis.semis_option_lookup_view
        WHERE domain = 'transfer_status'
    ),
    ou_by_uid AS
    (
        SELECT ou_uid AS u_uid FROM semis.semis_src_orgunit_view
    ),
    ou_by_name AS
    (
        -- Destination stored as a school name: match only names that are unique.
        SELECT ou_name AS n_name, any(ou_uid) AS n_uid
        FROM semis.semis_src_orgunit_view
        WHERE ou_level = (SELECT max(ou_level) FROM semis.semis_src_orgunit_view)
        GROUP BY ou_name
        HAVING count() = 1
    )
SELECT
    tr.event_uid                         AS transfer_uid,
    tr.enrollment_uid                    AS enrollment_uid,
    tr.tei_uid                           AS learner_uid,
    tr.ou_uid                            AS origin_school_uid,       -- the transfer event stays at the origin school
    multiIf(ifNull(u.u_uid, '') != '', ifNull(u.u_uid, ''),
            ifNull(n.n_uid, '') != '', ifNull(n.n_uid, ''),
            '')                          AS destination_school_uid,  -- empty until approval if not chosen
    tr.dest_raw                          AS destination_value,
    if(ifNull(st.st_code, '') != '', ifNull(st.st_code, ''), tr.st_raw) AS transfer_status_code,
    multiIf(lower(transfer_status_code) = lower((SELECT transfer_approved_code FROM semis.semis_config_view))
              OR positionCaseInsensitive(transfer_status_code, 'approv') > 0,                           'Approved',
            lower(transfer_status_code) = lower((SELECT transfer_rejected_code FROM semis.semis_config_view))
              OR positionCaseInsensitive(transfer_status_code, 'reject') > 0
              OR positionCaseInsensitive(transfer_status_code, 'reprov') > 0
              OR positionCaseInsensitive(transfer_status_code, 'declin') > 0,                           'Rejected',
            positionCaseInsensitive(transfer_status_code, 'cancel') > 0,                                'Cancelled',
            'Pending')                   AS transfer_status,
    tr.reason_raw                        AS transfer_reason,
    tr.occurred_at                       AS requested_at
FROM tr
LEFT JOIN st                ON st.st_k = tr.st_key
LEFT JOIN ou_by_uid  AS u   ON u.u_uid = tr.dest_raw
LEFT JOIN ou_by_name AS n   ON n.n_name = tr.dest_raw
SETTINGS join_use_nulls = 0;


-- @view semis_stg_attendance
-- One row per learner per school day with attendance recorded: the status of
-- the day's latest attendance event (Present, Late, Absent or Leave). Values
-- are matched to the codes set in Configurations > Attendance, else by name.
SELECT enrollment_uid, learner_uid, school_uid, day, status
FROM
(
    SELECT e.enrollment_uid AS enrollment_uid, e.tei_uid AS learner_uid, e.ou_uid AS school_uid,
           toDate(e.occurred_at) AS day, e.occurred_at AS recorded_at,
           multiIf(has(c.pc, lower(e.code)) OR (empty(c.pc) AND positionCaseInsensitive(e.label, 'present') > 0), 'Present',
                   has(c.lc, lower(e.code)) OR (empty(c.lc) AND positionCaseInsensitive(e.label, 'late') > 0),    'Late',
                   has(c.ac, lower(e.code)) OR (empty(c.ac) AND positionCaseInsensitive(e.label, 'absent') > 0),  'Absent',
                   has(c.vc, lower(e.code)) OR (empty(c.vc) AND positionCaseInsensitive(e.label, 'leave') > 0),   'Leave',
                   'Other') AS status
    FROM
    (
        SELECT ev.enrollment_uid, ev.tei_uid, ev.ou_uid, ev.occurred_at,
               if(ifNull(ol.option_code, '') != '', ifNull(ol.option_code, ''), ev.attendance_value) AS code,
               concat(ev.attendance_value, ' ', ifNull(ol.option_name, ''))                          AS label
        FROM semis.semis_src_event_view AS ev
        LEFT JOIN (SELECT option_key, option_code, option_name FROM semis.semis_option_lookup_view
                   WHERE domain = 'attendance') AS ol ON ol.option_key = lower(ev.attendance_value)
        WHERE ev.stage_uid = (SELECT attendance_stage_uid FROM semis.semis_config_view)
          AND ev.is_deleted = 0 AND ev.attendance_value != '' AND ev.occurred_at IS NOT NULL
    ) AS e
    CROSS JOIN
    (
        SELECT arrayMap(x -> lower(x), attendance_present_codes) AS pc, arrayMap(x -> lower(x), attendance_late_codes) AS lc,
               arrayMap(x -> lower(x), attendance_absent_codes) AS ac, arrayMap(x -> lower(x), attendance_leave_codes) AS vc
        FROM semis.semis_config_view
    ) AS c
)
WHERE status != 'Other'
ORDER BY enrollment_uid, day, recorded_at DESC
LIMIT 1 BY enrollment_uid, day
SETTINGS join_use_nulls = 0;


-- @view semis_stg_registration
-- One row per learner per academic year, with the final result and whether
-- the learner transferred in during that year.
WITH
    reg AS
    (
        SELECT event_uid, enrollment_uid, tei_uid, ou_uid, occurred_at,
               academic_year AS r_year, grade AS r_grade, class_section AS r_class
        FROM semis.semis_src_event_view
        WHERE stage_uid = (SELECT registration_stage_uid FROM semis.semis_config_view)
          AND is_deleted = 0
    ),
    fr AS
    (
        SELECT
            e.enrollment_uid                                                    AS fr_enrollment,
            argMax(if(ifNull(ol.option_code, '') != '', ifNull(ol.option_code, ''), e.fd_raw), e.fr_at) AS fr_decision,
            max(e.fr_at)                                                        AS fr_at_max
        FROM
        (
            SELECT enrollment_uid, final_decision AS fd_raw, lower(final_decision) AS fd_key,
                   ifNull(occurred_at, toDateTime(0)) AS fr_at
            FROM semis.semis_src_event_view
            WHERE stage_uid = (SELECT final_result_stage_uid FROM semis.semis_config_view)
              AND is_deleted = 0
              AND final_decision != ''
        ) AS e
        LEFT JOIN
        (
            SELECT option_key, option_code FROM semis.semis_option_lookup_view WHERE domain = 'final_result'
        ) AS ol ON ol.option_key = e.fd_key
        GROUP BY e.enrollment_uid
    ),
    dr AS
    (
        -- Dropout reason shown by its option name; "specify" text kept as written.
        SELECT e.dr_enrollment, e.dr_code, e.dr_other,
               if(ifNull(ol.option_name, '') != '', ifNull(ol.option_name, ''), e.dr_code) AS dr_reason
        FROM
        (
            SELECT enrollment_uid                                                          AS dr_enrollment,
                   argMaxIf(dropout_reason, ifNull(occurred_at, toDateTime(0)), dropout_reason != '') AS dr_code,
                   argMaxIf(dropout_reason_other, ifNull(occurred_at, toDateTime(0)),
                            trimBoth(dropout_reason_other) != '')                          AS dr_other
            FROM semis.semis_src_event_view
            WHERE is_deleted = 0 AND (dropout_reason != '' OR trimBoth(dropout_reason_other) != '')
            GROUP BY enrollment_uid
        ) AS e
        LEFT JOIN
        (
            SELECT option_key, option_name FROM semis.semis_option_lookup_view WHERE domain = 'dropout_reason'
        ) AS ol ON ol.option_key = lower(e.dr_code)
    ),
    att AS
    (
        -- Attendance days recorded on the enrollment.
        SELECT enrollment_uid                          AS att_enrollment,
               countIf(status IN ('Present', 'Late'))  AS att_attended,
               countIf(status = 'Absent')              AS att_absent,
               countIf(status = 'Leave')               AS att_leave,
               count()                                 AS att_recorded
        FROM semis.semis_stg_attendance_view
        GROUP BY enrollment_uid
    ),
    tin AS
    (
        SELECT
            enrollment_uid                          AS tin_enrollment,
            toUInt8(1)                              AS tin_flag,
            argMin(origin_school_uid, requested_at) AS tin_origin
        FROM semis.semis_stg_transfer_view
        WHERE transfer_status = 'Approved'
        GROUP BY enrollment_uid
    ),
    enr AS
    (
        SELECT enrollment_uid AS e_enrollment, enrollment_status AS e_status
        FROM semis.semis_src_enrollment_view
        WHERE is_deleted = 0
    ),
    cal AS
    (
        SELECT academic_year AS c_year, any(year_start) AS c_year_start
        FROM semis.semis_calendar_view GROUP BY academic_year
    ),
    cal_label AS
    (
        SELECT academic_year_label AS l_label, any(year_start) AS l_year_start
        FROM semis.semis_calendar_view GROUP BY academic_year_label
    ),
    codes AS
    (
        -- Configured values (codes or names) expanded to option codes.
        SELECT
            arrayConcat(groupUniqArrayIf(lower(option_code),
                            has((SELECT arrayMap(x -> lower(x), dropout_values) FROM semis.semis_config_view), option_key)),
                        (SELECT arrayMap(x -> lower(x), dropout_values) FROM semis.semis_config_view))    AS dropout_codes,
            arrayConcat(groupUniqArrayIf(lower(option_code),
                            has((SELECT arrayMap(x -> lower(x), promotable_values) FROM semis.semis_config_view), option_key)),
                        (SELECT arrayMap(x -> lower(x), promotable_values) FROM semis.semis_config_view)) AS promotable_codes
        FROM semis.semis_option_lookup_view
        WHERE domain = 'final_result'
    )
SELECT
    *,
    count() OVER (PARTITION BY learner_uid, academic_year) AS registrations_in_year
FROM
(
    SELECT
        reg.tei_uid                                                AS learner_uid,
        reg.enrollment_uid                                         AS enrollment_uid,
        reg.event_uid                                              AS registration_event_uid,
        reg.r_year                                                 AS academic_year,
        multiIf(ifNull(cal.c_year_start, 0) > 0,       ifNull(cal.c_year_start, 0),
                ifNull(cal_label.l_year_start, 0) > 0, ifNull(cal_label.l_year_start, 0),
                toInt32OrZero(substring(academic_year, 1, 4)))     AS year_start,
        reg.r_grade                                                AS grade,
        toInt32OrZero(extract(grade, '[0-9]+'))                    AS grade_num,
        reg.r_class                                                AS class_section,
        reg.ou_uid                                                 AS school_uid,
        reg.occurred_at                                            AS registered_at,
        ifNull(enr.e_status, '')                                   AS enrollment_status,
        ifNull(fr.fr_decision, '')                                 AS final_decision,
        toUInt8(has((SELECT dropout_codes FROM codes), lower(final_decision))
                OR positionCaseInsensitive(final_decision, 'drop') > 0
                OR enrollment_status = 'CANCELLED')                AS is_explicit_dropout,
        multiIf(is_explicit_dropout = 1,                                        'Dropout',
                final_decision = '',                                            'No result',
                has((SELECT promotable_codes FROM codes), lower(final_decision))
                  OR positionCaseInsensitive(final_decision, 'promot') > 0
                  OR positionCaseInsensitive(final_decision, 'pass') > 0,       'Promoted',
                positionCaseInsensitive(final_decision, 'complet') > 0
                  OR positionCaseInsensitive(final_decision, 'graduat') > 0,    'Completed',
                'Not promoted')                                    AS final_outcome,
        ifNull(dr.dr_reason, '')                                   AS dropout_reason,
        ifNull(dr.dr_code, '')                                     AS dropout_reason_code,
        trimBoth(ifNull(dr.dr_other, ''))                          AS dropout_reason_other,
        toUInt8(ifNull(tin.tin_flag, 0))                           AS transferred_in,
        ifNull(tin.tin_origin, '')                                 AS transferred_from_uid,
        toUInt32(ifNull(att.att_recorded, 0))                      AS att_recorded_days,
        toUInt32(ifNull(att.att_attended, 0))                      AS att_attended_days,
        toUInt32(ifNull(att.att_absent, 0))                        AS att_absent_days,
        toUInt32(ifNull(att.att_leave, 0))                         AS att_leave_days
    FROM reg
    INNER JOIN enr            ON enr.e_enrollment = reg.enrollment_uid
    LEFT JOIN fr              ON fr.fr_enrollment = reg.enrollment_uid
    LEFT JOIN dr              ON dr.dr_enrollment = reg.enrollment_uid
    LEFT JOIN tin             ON tin.tin_enrollment = reg.enrollment_uid
    LEFT JOIN att             ON att.att_enrollment = reg.enrollment_uid
    LEFT JOIN cal             ON cal.c_year = reg.r_year
    LEFT JOIN cal_label       ON cal_label.l_label = reg.r_year
    WHERE reg.r_year != ''
) AS j
ORDER BY learner_uid, academic_year, registered_at DESC
LIMIT 1 BY learner_uid, academic_year
SETTINGS join_use_nulls = 0;


-- @view semis_learner
-- One row per learner: identity, admission (cohort) year and entry standard.
WITH
    enr AS
    (
        SELECT
            tei_uid                                                              AS e_learner,
            argMin(enrollment_uid, ifNull(enrolled_at, toDateTime('2100-01-01'))) AS e_first_enrollment,
            argMin(ou_uid,         ifNull(enrolled_at, toDateTime('2100-01-01'))) AS e_first_ou,
            min(enrolled_at)                                                     AS e_first_enrolled_at
        FROM semis.semis_src_enrollment_view
        WHERE program_uid = (SELECT program_uid FROM semis.semis_config_view)
          AND is_deleted = 0
        GROUP BY tei_uid
    ),
    attrs AS
    (
        SELECT
            tei_uid                                         AS a_learner,
            anyIf(gender_raw, gender_raw != '')             AS a_gender,
            min(date_of_birth)                              AS a_dob,
            min(admission_date)                             AS a_adm_date,
            anyIf(admission_year_raw, admission_year_raw != '') AS a_adm_year,
            anyIf(learner_id, learner_id != '')             AS a_learner_id,
            anyIf(ecd_raw, ecd_raw != '')                   AS a_ecd,
            anyIf(disability_raw, disability_raw != '')     AS a_disability,
            anyIf(orphan_raw, orphan_raw != '')             AS a_orphan,
            anyIf(village_raw, trimBoth(village_raw) != '') AS a_village
        FROM semis.semis_src_learner_view
        WHERE is_deleted = 0
          AND tei_uid IN (SELECT e_learner FROM enr)
        GROUP BY tei_uid
    ),
    yrs AS
    (
        SELECT
            learner_uid                                  AS y_learner,
            min(year_start)                              AS y_first_year,
            argMin(academic_year, year_start)            AS y_first_academic_year,
            argMin(grade, year_start)                    AS y_entry_grade,
            argMin(grade_num, year_start)                AS y_entry_grade_num,
            argMin(school_uid, year_start)               AS y_first_school,
            max(year_start)                              AS y_last_year,
            count()                                      AS y_years
        FROM semis.semis_stg_registration_view
        WHERE year_start > 0
        GROUP BY learner_uid
    ),
    first_tr AS
    (
        SELECT enrollment_uid AS t_enrollment, argMin(origin_school_uid, requested_at) AS t_origin
        FROM semis.semis_stg_transfer_view
        WHERE transfer_status = 'Approved'
        GROUP BY enrollment_uid
    ),
    cal AS
    (
        SELECT academic_year AS c_year, any(year_start) AS c_year_start
        FROM semis.semis_calendar_view GROUP BY academic_year
    ),
    cal_label AS
    (
        SELECT academic_year_label AS l_label, any(year_start) AS l_year_start
        FROM semis.semis_calendar_view GROUP BY academic_year_label
    ),
    dis_names AS
    (
        SELECT option_key AS dn_key, any(option_name) AS dn_name
        FROM semis.semis_option_lookup_view WHERE domain = 'disability' GROUP BY option_key
    ),
    orp_names AS
    (
        SELECT option_key AS on_key, any(option_name) AS on_name
        FROM semis.semis_option_lookup_view WHERE domain = 'orphan' GROUP BY option_key
    )
SELECT
    enr.e_learner                                                        AS learner_uid,
    ifNull(a.a_learner_id, '')                                           AS learner_id,
    multiIf(startsWith(lower(ifNull(a.a_gender, '')), 'f'), 'Female',
            startsWith(lower(ifNull(a.a_gender, '')), 'm'), 'Male',
            'Not recorded')                                              AS gender,
    toDate(a.a_dob)                                                      AS date_of_birth,
    toDate(a.a_adm_date)                                                 AS admission_date,   -- as recorded, else NULL
    ifNull(admission_date, toDate(enr.e_first_enrolled_at))              AS admission_or_enrolment_date,
    -- Admission (cohort) year: attribute, else calendar year containing the
    -- admission date (or first enrolment date), else first registration year,
    -- else calendar year.
    multiIf(ifNull(cal.c_year_start, 0) > 0,       ifNull(cal.c_year_start, 0),
            ifNull(cal_label.l_year_start, 0) > 0, ifNull(cal_label.l_year_start, 0),
            toInt32OrZero(substring(ifNull(a.a_adm_year, ''), 1, 4)))    AS adm_year_from_attribute,
    arrayFirst(t -> ifNull(admission_or_enrolment_date, toDate('1970-01-01')) >= t.2
                 AND ifNull(admission_or_enrolment_date, toDate('1970-01-01')) <= t.3,
               (SELECT groupArray((year_start, assumeNotNull(start_date), assumeNotNull(end_date)))
                FROM semis.semis_calendar_view
                WHERE start_date IS NOT NULL AND end_date IS NOT NULL)).1 AS adm_year_from_calendar,
    multiIf(adm_year_from_attribute > 1900, adm_year_from_attribute,
            adm_year_from_calendar > 1900,  adm_year_from_calendar,
            ifNull(y.y_first_year, 0) > 0,  ifNull(y.y_first_year, 0),
            toInt32(ifNull(toYear(admission_or_enrolment_date), 0)))     AS admission_year_start,
    if(ifNull(ft.t_origin, '') != '', ifNull(ft.t_origin, ''), enr.e_first_ou) AS admission_school_uid,
    ifNull(y.y_first_year, 0)                                            AS first_year_start,
    ifNull(y.y_first_academic_year, '')                                  AS first_academic_year,
    ifNull(y.y_entry_grade, '')                                          AS entry_grade,
    ifNull(y.y_entry_grade_num, 0)                                       AS entry_grade_num,
    ifNull(y.y_first_school, '')                                         AS first_school_uid,
    ifNull(y.y_last_year, 0)                                             AS last_year_start,
    toUInt32(ifNull(y.y_years, 0))                                       AS years_registered,
    toUInt8(ifNull(y.y_years, 0) > 0)                                    AS has_registration,
    -- Learner profile
    multiIf(lower(a.a_ecd) IN ('true', 'yes', '1'),  'Yes',
            lower(a.a_ecd) IN ('false', 'no', '0'),  'No',
            'Not recorded')                                              AS attended_ecd,
    a.a_disability                                                       AS disability_code,
    multiIf(a.a_disability = '', 'Not recorded',
            dn.dn_name != '',    dn.dn_name,
            a.a_disability)                                              AS disability,
    toUInt8(a.a_disability != ''
            AND NOT has((SELECT no_disability_values FROM semis.semis_config_view), lower(a.a_disability))
            AND NOT has((SELECT no_disability_values FROM semis.semis_config_view), lower(dn.dn_name))) AS has_disability,
    multiIf(a.a_orphan = '', 'Not recorded',
            orn.on_name != '', orn.on_name,
            a.a_orphan)                                                  AS orphan_status,
    toUInt8(a.a_orphan != ''
            AND NOT has((SELECT not_orphan_values FROM semis.semis_config_view), lower(a.a_orphan))
            AND NOT has((SELECT not_orphan_values FROM semis.semis_config_view), lower(orn.on_name))) AS is_orphan,
    -- Village as typed, with spacing and capitals made consistent.
    if(trimBoth(a.a_village) = '', 'Not recorded',
       initcapUTF8(replaceRegexpAll(trimBoth(a.a_village), '\\s+', ' '))) AS village
FROM enr
LEFT JOIN attrs    AS a  ON a.a_learner = enr.e_learner
LEFT JOIN dis_names AS dn ON dn.dn_key = lower(a.a_disability)
LEFT JOIN orp_names AS orn ON orn.on_key = lower(a.a_orphan)
LEFT JOIN yrs      AS y  ON y.y_learner = enr.e_learner
LEFT JOIN first_tr AS ft ON ft.t_enrollment = enr.e_first_enrollment
LEFT JOIN cal             ON cal.c_year = a.a_adm_year
LEFT JOIN cal_label       ON cal_label.l_label = a.a_adm_year
SETTINGS join_use_nulls = 0;


-- =============================================================================
-- LAYER 4  DASHBOARD DATASETS (each has OrgUnitHierarchyPath)
-- =============================================================================

-- @view semis_learner_year
-- One row per learner per academic year, at the school of registration.
-- Enrolment, flow (promotion, repetition, dropout, completion), age for grade.
WITH
    nxt AS
    (
        SELECT learner_uid AS n_learner, year_start AS n_year, grade AS n_grade,
               grade_num AS n_grade_num, school_uid AS n_school, toUInt8(1) AS n_present
        FROM semis.semis_stg_registration_view
    ),
    prv AS
    (
        SELECT learner_uid AS p_learner, year_start AS p_year, grade_num AS p_grade_num, toUInt8(1) AS p_present,
               is_explicit_dropout AS p_dropout
        FROM semis.semis_stg_registration_view
    ),
    cal AS
    (
        SELECT year_start AS c_year, academic_year_label AS c_label, start_date AS c_start
        FROM semis.semis_calendar_view
        ORDER BY start_date
        LIMIT 1 BY year_start
    )
SELECT
    -- Where
    o.OrgUnitHierarchyPath                                         AS OrgUnitHierarchyPath,
    o.level1_name                                                  AS level1_name,
    o.level2_name                                                  AS level2_name,
    o.level3_name                                                  AS level3_name,
    o.level4_name                                                  AS level4_name,
    r.school_uid                                                   AS school_uid,
    o.ou_name                                                      AS school_name,
    -- When
    r.academic_year                                                AS academic_year,
    coalesce(nullIf(ifNull(c.c_label, ''), ''), r.academic_year)   AS academic_year_label,
    r.year_start                                                   AS year_start,
    ifNull(c.c_start, makeDate(r.year_start, 1, 1))                AS academic_year_start_date,
    toUInt8(ifNull(r.year_start = (SELECT current_year_start FROM semis.semis_config_view), 0)) AS is_current_year,
    -- Who
    r.learner_uid                                                  AS learner_uid,
    l.learner_id                                                   AS learner_id,
    l.gender                                                       AS gender,
    if(l.date_of_birth IS NULL, NULL,
       toInt32(floor(dateDiff('day', l.date_of_birth, academic_year_start_date) / 365.25))) AS age_at_start,
    toInt32(ifNull((SELECT official_entry_age FROM semis.semis_config_view), 6)) + r.grade_num - 1 AS expected_age,
    age_at_start - expected_age                                    AS over_age_years,
    multiIf(age_at_start IS NULL OR r.grade_num = 0, 'Not recorded',
            over_age_years < 0,  'Under-age',
            over_age_years = 0,  'On-age',
            over_age_years = 1,  '1 year over-age',
            '2+ years over-age')                                   AS age_for_grade,
    -- What
    r.grade                                                        AS grade,
    r.grade_num                                                    AS grade_num,
    r.class_section                                                AS class_section,
    r.enrollment_status                                            AS enrollment_status,
    r.final_decision                                               AS final_decision,
    r.final_outcome                                                AS final_outcome,
    r.dropout_reason                                               AS dropout_reason,
    r.dropout_reason_code                                          AS dropout_reason_code,
    r.dropout_reason_other                                         AS dropout_reason_other,
    r.transferred_in                                               AS transferred_in,
    multiIf(r.year_start = l.first_year_start,           'New entrant',
            ifNull(p.p_present, 0) = 0,                  'Re-entry',
            ifNull(p.p_grade_num, 0) = r.grade_num,      'Repeater',
            'Continuing')                                          AS entry_type,
    -- Back after a year with no registration, or after a dropout result last year.
    toUInt8(r.year_start != l.first_year_start
            AND (ifNull(p.p_present, 0) = 0 OR ifNull(p.p_dropout, 0) = 1)) AS is_readmitted,
    -- Profile (from the learner's attributes)
    l.attended_ecd                                                 AS attended_ecd,
    l.disability                                                   AS disability,
    l.has_disability                                               AS has_disability,
    l.orphan_status                                                AS orphan_status,
    l.is_orphan                                                    AS is_orphan,
    l.village                                                      AS village,
    -- Attendance in the year (days with attendance recorded)
    r.att_recorded_days                                            AS att_recorded_days,
    r.att_attended_days                                            AS att_attended_days,
    r.att_absent_days + r.att_leave_days                           AS att_missed_days,
    if(r.att_recorded_days > 0, r.att_attended_days / r.att_recorded_days, NULL) AS attendance_rate,
    toUInt8(r.att_recorded_days >= (SELECT chronic_absence_min_days FROM semis.semis_config_view)) AS att_assessed,
    toUInt8(att_assessed = 1
            AND att_missed_days >= (SELECT chronic_absence_share FROM semis.semis_config_view) * r.att_recorded_days) AS is_chronically_absent,
    -- Next year
    toUInt8(ifNull(n.n_present, 0))                                AS has_next_year,
    ifNull(n.n_grade, '')                                          AS next_grade,
    ifNull(n.n_school, '')                                         AS next_school_uid,
    toUInt8(has_next_year = 1 AND next_school_uid != r.school_uid) AS changed_school_next_year,
    ifNull(cn.c_start, makeDate(r.year_start + 1, 1, 1))           AS next_year_start_date,
    multiIf(
        r.is_explicit_dropout = 1,                                                          'Dropped out',
        has_next_year = 1 AND ifNull(n.n_grade_num, 0) >  r.grade_num,                      'Promoted',
        has_next_year = 1 AND ifNull(n.n_grade_num, 0) =  r.grade_num,                      'Repeated',
        has_next_year = 1,                                                                  'Moved down a grade',
        r.final_outcome = 'Completed'
          OR (r.grade_num >= (SELECT final_grade_num FROM semis.semis_config_view)
              AND r.final_outcome = 'Promoted'),                                            'Completed',
        r.year_start >= (SELECT current_year_start FROM semis.semis_config_view),                'In progress',
        today() < next_year_start_date + (SELECT silent_dropout_grace_days FROM semis.semis_config_view), 'Awaiting re-enrolment',
        'Not re-enrolled')                                         AS flow_status,
    toUInt8(flow_status NOT IN ('In progress', 'Awaiting re-enrolment'))  AS is_closed,
    toUInt8(flow_status IN ('Dropped out', 'Not re-enrolled'))            AS is_dropout,
    toUInt8(flow_status = 'Promoted')                              AS is_promoted,
    toUInt8(flow_status = 'Repeated')                              AS is_repeated,
    toUInt8(flow_status = 'Completed')                             AS is_completed,
    -- Sankey labels (source and target never share a node)
    r.grade                                                        AS flow_from,
    multiIf(flow_status = 'Promoted', concat('Next year: ', next_grade),
            flow_status = 'Repeated', concat('Repeated ', r.grade),
            flow_status)                                           AS flow_to,
    r.registrations_in_year                                        AS registrations_in_year
FROM
(
    SELECT *, year_start + 1 AS next_year, year_start - 1 AS prev_year
    FROM semis.semis_stg_registration_view
) AS r
INNER JOIN semis.semis_learner_view AS l ON l.learner_uid = r.learner_uid
LEFT JOIN nxt AS n  ON n.n_learner = r.learner_uid AND n.n_year = r.next_year
LEFT JOIN prv AS p  ON p.p_learner = r.learner_uid AND p.p_year = r.prev_year
LEFT JOIN cal AS c  ON c.c_year = r.year_start
LEFT JOIN cal AS cn ON cn.c_year = r.next_year
LEFT JOIN semis.semis_orgunit_view AS o ON o.ou_uid = r.school_uid
WHERE r.year_start > 0
SETTINGS join_use_nulls = 0;


-- @view semis_admissions
-- One row per admitted learner, at the admitting school.
WITH
    cal AS
    (
        SELECT year_start AS c_year, academic_year AS c_code, academic_year_label AS c_label
        FROM semis.semis_calendar_view
        ORDER BY start_date
        LIMIT 1 BY year_start
    )
SELECT
    o.OrgUnitHierarchyPath                                         AS OrgUnitHierarchyPath,
    o.level1_name                                                  AS level1_name,
    o.level2_name                                                  AS level2_name,
    o.level3_name                                                  AS level3_name,
    o.level4_name                                                  AS level4_name,
    l.admission_school_uid                                         AS school_uid,
    o.ou_name                                                      AS school_name,
    coalesce(nullIf(ifNull(c.c_code, ''), ''), toString(l.admission_year_start)) AS academic_year,
    coalesce(nullIf(ifNull(c.c_label, ''), ''), toString(l.admission_year_start)) AS academic_year_label,
    l.admission_year_start                                         AS year_start,
    l.admission_date                                               AS admission_date,   -- NULL when not recorded
    toStartOfMonth(l.admission_date)                               AS admission_month,
    toUInt8(l.admission_date IS NOT NULL)                          AS has_admission_date,
    l.learner_uid                                                  AS learner_uid,
    l.learner_id                                                   AS learner_id,
    l.gender                                                       AS gender,
    if(l.date_of_birth IS NULL OR l.admission_date IS NULL, NULL,
       toInt32(floor(dateDiff('day', l.date_of_birth, l.admission_date) / 365.25))) AS age_at_admission,
    l.entry_grade                                                  AS entry_grade,
    l.entry_grade_num                                              AS entry_grade_num,
    toUInt8(l.entry_grade_num > 1)                                 AS is_late_entry,
    multiIf(l.has_registration = 0,                           'Admitted, not enrolled',
            l.first_year_start <= l.admission_year_start,     'Enrolled in admission year',
            'Enrolled in a later year')                            AS admission_status
FROM semis.semis_learner_view AS l
LEFT JOIN cal AS c ON c.c_year = l.admission_year_start
LEFT JOIN semis.semis_orgunit_view AS o ON o.ou_uid = l.admission_school_uid
WHERE l.admission_year_start > 0
SETTINGS join_use_nulls = 0;


-- @view semis_cohort
-- One row per learner per year since admission, from the admission year to
-- the current year. Cohort = admission year; entry standard = standard of the
-- first registration. A learner first registered after the admission year
-- is behind the cohort for those years.
-- Rows sit at the entry school (the admitting school, corrected for a
-- transfer approved in the first enrollment).
WITH
    hist AS
    (
        SELECT learner_uid AS h_learner,
               groupArray((year_start, grade_num, school_uid, flow_status)) AS h_years
        FROM semis.semis_learner_year_view
        GROUP BY learner_uid
    ),
    cal AS
    (
        SELECT year_start AS c_year, any(academic_year) AS c_code, any(academic_year_label) AS c_label
        FROM semis.semis_calendar_view GROUP BY year_start
    )
SELECT
    o.OrgUnitHierarchyPath                                         AS OrgUnitHierarchyPath,
    o.level1_name                                                  AS level1_name,
    o.level2_name                                                  AS level2_name,
    o.level3_name                                                  AS level3_name,
    o.level4_name                                                  AS level4_name,
    b.entry_school_uid                                             AS school_uid,
    o.ou_name                                                      AS school_name,
    coalesce(nullIf(ifNull(c.c_code, ''), ''), toString(b.cohort_start))  AS cohort_year,
    coalesce(nullIf(ifNull(c.c_label, ''), ''),
             concat(toString(b.cohort_start - 1), '-', toString(b.cohort_start))) AS cohort_year_label,
    b.cohort_start                                                 AS cohort_year_start,
    b.entry_grade                                                  AS entry_grade,
    b.entry_grade_num                                              AS entry_grade_num,
    b.learner_uid                                                  AS learner_uid,
    b.gender                                                       AS gender,
    toInt32(b.k)                                                   AS years_since_entry,
    toUInt8(b.year_at_k = (SELECT current_year_start FROM semis.semis_config_view)) AS is_current_year,
    b.year_at_k                                                    AS year_start,
    arrayExists(t -> t.1 = b.year_at_k, h.h_years)                 AS is_enrolled,
    arrayExists(t -> t.1 < b.year_at_k AND t.4 = 'Completed', h.h_years) AS completed_before,
    multiIf(is_enrolled = 1 AND arrayFirst(t -> t.1 = b.year_at_k, h.h_years).3 = b.entry_school_uid,  'In school (same school)',
            is_enrolled = 1,                                       'In school (other school)',
            completed_before = 1,                                  'Completed',
            arrayElement(arraySort(t -> t.1, arrayFilter(t -> t.1 < b.year_at_k, h.h_years)), -1).4
              = 'Awaiting re-enrolment',                           'Awaiting re-enrolment',
            'Out of school')                                       AS cohort_status,
    toUInt8(is_enrolled = 1 OR completed_before = 1)               AS is_retained,
    toUInt8(cohort_status != 'Awaiting re-enrolment')              AS is_determined,
    if(is_enrolled = 1, arrayFirst(t -> t.1 = b.year_at_k, h.h_years).2, 0)                            AS grade_num_in_year,
    arrayMax(arrayMap(t -> t.2, arrayFilter(t -> t.1 <= b.year_at_k, h.h_years))) AS highest_grade_reached,
    -- On track: in the expected standard or higher; after the last standard,
    -- completed it no later than expected.
    toUInt8(if(is_enrolled = 1,
               arrayFirst(t -> t.1 = b.year_at_k, h.h_years).2 >= b.entry_grade_num + toInt32(b.k),
               completed_before = 1
                 AND arrayMin(arrayMap(t -> t.1, arrayFilter(t -> t.4 = 'Completed', h.h_years)))
                     <= b.cohort_start + b.final_grade_num - b.entry_grade_num)) AS is_on_track
FROM
(
    SELECT
        learner_uid, gender,
        if(admission_year_start > 0, admission_year_start, first_year_start) AS cohort_start,
        if(admission_school_uid != '', admission_school_uid, first_school_uid) AS entry_school_uid,
        entry_grade, entry_grade_num,
        arrayJoin(range(toUInt32(greatest((SELECT current_year_start FROM semis.semis_config_view) - cohort_start, 0) + 1))) AS k,
        (SELECT final_grade_num FROM semis.semis_config_view)             AS final_grade_num,
        cohort_start + toInt32(k) AS year_at_k
    FROM semis.semis_learner_view
    WHERE has_registration = 1 AND first_year_start > 0
) AS b
LEFT JOIN hist AS h ON h.h_learner = b.learner_uid
LEFT JOIN semis.semis_orgunit_view AS o ON o.ou_uid = b.entry_school_uid
LEFT JOIN cal AS c ON c.c_year = b.cohort_start
SETTINGS join_use_nulls = 0;


-- @view semis_transfers
-- One row per transfer per side: "Outgoing" at the origin school and
-- "Incoming" at the destination school, so each school sees both.
SELECT
    o.OrgUnitHierarchyPath                                         AS OrgUnitHierarchyPath,
    o.level1_name                                                  AS level1_name,
    o.level2_name                                                  AS level2_name,
    o.level3_name                                                  AS level3_name,
    o.level4_name                                                  AS level4_name,
    d.side_school_uid                                              AS school_uid,
    o.ou_name                                                      AS school_name,
    d.direction                                                    AS direction,
    d.counterpart_uid                                              AS counterpart_school_uid,
    ifNull(oc.ou_name, '')                                         AS counterpart_school_name,
    ifNull(oc.level3_name, '')                                     AS counterpart_level3_name,
    toUInt8(ifNull(oc.level3_uid, '') != '' AND ifNull(oc.level3_uid, '') != o.level3_uid) AS is_cross_level3,
    d.transfer_uid                                                 AS transfer_uid,
    d.learner_uid                                                  AS learner_uid,
    ifNull(l.learner_id, '')                                       AS learner_id,
    ifNull(l.gender, 'Not recorded')                               AS gender,
    ifNull(r.r_year, '')                                           AS academic_year,
    coalesce(nullIf(ifNull(cl.c_label, ''), ''), ifNull(r.r_year, '')) AS academic_year_label,
    ifNull(r.r_grade, '')                                          AS grade,
    d.transfer_status                                              AS transfer_status,
    if(d.transfer_reason = '', 'Not recorded', d.transfer_reason)  AS transfer_reason,
    d.requested_at                                                 AS requested_at,
    toDate(d.requested_at)                                         AS requested_date,
    if(d.transfer_status = 'Pending', dateDiff('day', d.requested_at, now()), NULL) AS days_pending
FROM
(
    SELECT
        *,
        arrayJoin(if(destination_school_uid != '', ['Outgoing', 'Incoming'], ['Outgoing'])) AS direction,
        if(direction = 'Outgoing', origin_school_uid, destination_school_uid) AS side_school_uid,
        if(direction = 'Outgoing', destination_school_uid, origin_school_uid) AS counterpart_uid
    FROM semis.semis_stg_transfer_view
) AS d
LEFT JOIN semis.semis_orgunit_view AS o  ON o.ou_uid = d.side_school_uid
LEFT JOIN semis.semis_orgunit_view AS oc ON oc.ou_uid = d.counterpart_uid
LEFT JOIN semis.semis_learner_view AS l  ON l.learner_uid = d.learner_uid
LEFT JOIN
(
    SELECT enrollment_uid AS r_enrollment, academic_year AS r_year, year_start AS r_year_start, grade AS r_grade
    FROM semis.semis_stg_registration_view
) AS r ON r.r_enrollment = d.enrollment_uid
LEFT JOIN
(
    SELECT year_start AS c_year, any(academic_year_label) AS c_label
    FROM semis.semis_calendar_view GROUP BY year_start
) AS cl ON cl.c_year = r.r_year_start
SETTINGS join_use_nulls = 0;


-- @view semis_attendance
-- One row per school, day, standard and gender: learners with attendance
-- recorded, by status. Attendance rate = (present + late) / recorded.
WITH
    cal AS
    (
        SELECT year_start AS c_year, any(academic_year_label) AS c_label
        FROM semis.semis_calendar_view GROUP BY year_start
    )
SELECT
    o.OrgUnitHierarchyPath                                         AS OrgUnitHierarchyPath,
    o.level1_name                                                  AS level1_name,
    o.level2_name                                                  AS level2_name,
    o.level3_name                                                  AS level3_name,
    o.level4_name                                                  AS level4_name,
    a.school_uid                                                   AS school_uid,
    o.ou_name                                                      AS school_name,
    r.academic_year                                                AS academic_year,
    coalesce(nullIf(ifNull(c.c_label, ''), ''), r.academic_year)   AS academic_year_label,
    r.year_start                                                   AS year_start,
    a.day                                                          AS attendance_date,
    toStartOfMonth(a.day)                                          AS attendance_month,
    r.grade                                                        AS grade,
    r.grade_num                                                    AS grade_num,
    ifNull(l.gender, 'Not recorded')                               AS gender,
    countIf(a.status IN ('Present', 'Late'))                       AS attended,
    countIf(a.status = 'Present')                                  AS present,
    countIf(a.status = 'Late')                                     AS late,
    countIf(a.status = 'Absent')                                   AS absent,
    countIf(a.status = 'Leave')                                    AS on_leave,
    count()                                                        AS recorded
FROM semis.semis_stg_attendance_view AS a
INNER JOIN semis.semis_stg_registration_view AS r ON r.enrollment_uid = a.enrollment_uid
LEFT JOIN semis.semis_learner_view AS l ON l.learner_uid = r.learner_uid
LEFT JOIN semis.semis_orgunit_view AS o ON o.ou_uid = a.school_uid
LEFT JOIN cal AS c ON c.c_year = r.year_start
GROUP BY OrgUnitHierarchyPath, level1_name, level2_name, level3_name, level4_name, school_uid, school_name,
         academic_year, academic_year_label, year_start, attendance_date, attendance_month, grade, grade_num, gender
SETTINGS join_use_nulls = 0;


-- =============================================================================
-- CHECKS (run in AP or Superset SQL Lab after creating the views)
-- =============================================================================
-- 1. Settings: settings_source shows whether semis/values was used.
--    program_uid and the three stage UIDs must not be empty, and
--    current_academic_year should be the year in progress (codes are the
--    end year, e.g. 2027 for 2026-2027).
--      SELECT * FROM semis.semis_config_view;
--
-- 2. Option matching: expect rows for both domains.
--      SELECT domain, count() FROM semis.semis_option_lookup_view GROUP BY domain;
--
-- 3. Source rows reach the staging views.
--      SELECT
--        (SELECT count() FROM semis.semis_src_event_view)          AS events,
--        (SELECT count() FROM semis.semis_stg_registration_view)   AS learner_years,
--        (SELECT count() FROM semis.semis_learner_view)            AS learners,
--        (SELECT count() FROM semis.semis_stg_transfer_view)       AS transfers;
