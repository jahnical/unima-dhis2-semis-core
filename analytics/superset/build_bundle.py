"""Build the Superset (6.1) import bundle for the SEMIS learner dashboard.

Usage: python build_bundle.py <dataset_export_dir> <out.zip> [query_contexts.json]

The database and dataset files are copied unchanged from the user's own export, so
the import attaches to the existing connection and datasets. Charts use ad-hoc SQL
metrics, so they do not depend on saved metrics on the datasets."""
import io, json, sys, uuid, zipfile, glob, os
import yaml

EXPORT, OUT = sys.argv[1], sys.argv[2]
QC = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else {}
NS = uuid.UUID('6f6c1b0e-5e3a-4c1f-9b67-2b1c5e7d9a10')
U = lambda key: str(uuid.uuid5(NS, 'semis-learner-dashboard/' + key))
# Charts whose definition changed after a release get a new uuid, so importing over an existing
# dashboard adds them as new charts (Superset never overwrites existing charts on import).
REV = {"ov_conf_rate": 2, "ov_promo_rate": 2, "fl_rates_year": 2, "fl_rate_gender": 2, "ad_month": 2, "co_on_track": 2,
       "ov_matrix": 2, "co_matrix": 2, "co_retention": 2, "co_survival": 2, "co_status": 2}
CU = lambda key: U("chart/" + key + (f"#{REV[key]}" if key in REV else ""))

LY = '9b10c5d9-ca8f-410b-beb2-a08e55518df8'   # semis_learner_year_view
CO = '7e98b76a-b328-40e2-9182-e6583c2a7784'   # semis_cohort_view
AD = '2141af54-be93-47dd-ab79-9d3be6959d0b'   # semis_admissions_view
TR = 'ac77ad45-154c-4711-b85e-e41239e21de6'   # semis_transfers_view
# Virtual dataset for the Cohort filter and the matrices: the cohort view plus a label naming each intake by
# its admission year and the standard it is due in this year. Version 2 (new uuid and name) replaces
# semis_cohort_matrix, because Superset never updates an existing dataset on import.
CF = U("dataset/semis_cohort_matrix#2")
CF_NAME = "semis_cohort_intake"
CF_SQL = '''WITH (SELECT current_year_start FROM semis.semis_config_view) AS cur,
     (SELECT final_grade_num FROM semis.semis_config_view) AS fin
SELECT c.*,
       c.entry_grade_num + (cur - c.cohort_year_start) AS due_standard,
       concat(c.cohort_year_label,
              if(due_standard <= fin, concat(' (Std ', toString(due_standard), ' this year)'), ' (finished)')) AS intake,
       cur AS current_year_start,
       fin AS final_grade_num
FROM semis.semis_cohort_view AS c'''
# Virtual dataset for the Attendance tab: one row per school, day, standard and gender. A table name of its own,
# so it cannot clash with a dataset the platform creates for semis_attendance_view.
AT = U("dataset/semis_attendance_day")
AT_NAME = "semis_attendance_day"
AT_SQL = "SELECT * FROM semis.semis_attendance_view"
AT_COLS = [("OrgUnitHierarchyPath", "String"), ("level1_name", "String"), ("level2_name", "String"),
           ("level3_name", "String"), ("level4_name", "String"), ("school_uid", "String"), ("school_name", "String"),
           ("academic_year", "String"), ("academic_year_label", "String"), ("year_start", "Int32"),
           ("attendance_date", "Date"), ("attendance_month", "Date"), ("grade", "String"), ("grade_num", "Int32"),
           ("gender", "String"), ("attended", "UInt64"), ("present", "UInt64"), ("late", "UInt64"),
           ("absent", "UInt64"), ("on_leave", "UInt64"), ("recorded", "UInt64")]
# Saved metric that orders the Cohort filter: intakes still in school by the standard they are due in, highest
# first (so the default is the intake due in the last standard), then finished intakes, most recent first.
CF_ORDER = "max(if(due_standard <= final_grade_num, 100 + due_standard, 100 - due_standard))"


# ---------------------------------------------------------------- helpers
def M(label, sql):
    return {"expressionType": "SQL", "sqlExpression": sql, "label": label, "hasCustomLabel": True,
            "optionName": "metric_" + uuid.uuid5(NS, label + sql).hex[:12], "column": None, "aggregate": None,
            "datasourceWarning": False}


def F(sql, clause="WHERE"):
    return {"expressionType": "SQL", "sqlExpression": sql, "clause": clause, "subject": None, "operator": None,
            "comparator": None, "isExtra": False, "isNew": False, "datasourceWarning": False,
            "filterOptionName": "filter_" + uuid.uuid5(NS, clause + sql).hex[:12]}


def COL(col, label):
    return {"label": label, "sqlExpression": col, "expressionType": "SQL"}


NAMES = {"school_name": "School", "level3_name": "District", "level4_name": "Zone", "learner_id": "Learner ID",
         "admission_date": "Admission date", "age_at_admission": "Age at admission", "grade": "Standard",
         "counterpart_school_name": "Sending school", "requested_date": "Requested", "days_pending": "Days pending"}


def rate(num, den='is_closed = 1'):
    return f"countIf({num}) / nullIf(countIf({den}), 0)"


# metrics
LEARNERS = M("Learners", "count()")
CONF_DROPOUTS = M("Confirmed dropouts", "countIf(flow_status = 'Dropped out')")
NOT_REENROLLED = M("Not re-enrolled", "countIf(flow_status = 'Not re-enrolled')")
CONF_RATE = M("Confirmed dropout rate", rate("flow_status = 'Dropped out'"))
NRE_RATE = M("Not re-enrolled rate", rate("flow_status = 'Not re-enrolled'"))
DROP_RATE = M("Dropout rate (all)", rate("is_dropout = 1"))
PROMO_RATE = M("Promotion rate", rate("is_promoted = 1"))
REP_RATE = M("Repetition rate", rate("is_repeated = 1"))
GPI = M("Gender parity index", "countIf(gender = 'Female') / nullIf(countIf(gender = 'Male'), 0)")
AWAITING = M("Awaiting re-enrolment", "countIf(flow_status = 'Awaiting re-enrolment')")
RETENTION = M("Retention rate", "countIf(is_retained = 1) / nullIf(countIf(is_determined = 1), 0)")
ON_TRACK = M("On-track rate", "countIf(is_on_track = 1) / nullIf(countIf(is_determined = 1), 0)")
COHORT_N = M("Learners", "count()")
ADMISSIONS = M("Admissions", "count()")
TRANSFERS = M("Transfers", "uniqExact(transfer_uid)")
# Inclusion (learner-year dataset; the new columns are used through SQL expressions, so the dataset needs no sync)
FEMALE = M("Female", "countIf(gender = 'Female')")
MALE = M("Male", "countIf(gender = 'Male')")
ECD_SHARE = M("New entrants with ECD", "countIf(attended_ecd = 'Yes') / nullIf(countIf(attended_ecd IN ('Yes', 'No')), 0)")
SNE = M("Learners with special needs", "countIf(has_disability = 1)")
ORPHANS = M("Orphans", "countIf(is_orphan = 1)")
READMITTED = M("Re-admitted learners", "countIf(is_readmitted = 1)")
# Attendance
ATT_RATE = M("Attendance rate", "sum(attended) / nullIf(sum(recorded), 0)")
ATT_RATE_LY = M("Attendance rate", "sum(att_attended_days) / nullIf(sum(att_recorded_days), 0)")
CHRONIC_SHARE = M("Chronically absent", "countIf(is_chronically_absent = 1) / nullIf(countIf(att_assessed = 1), 0)")
CHRONIC_N = M("Chronically absent learners", "countIf(is_chronically_absent = 1)")
SCHOOLS_RECORDING = M("Schools recording attendance",
                      "uniqExactIf(school_uid, att_recorded_days > 0) / nullIf(uniqExact(school_uid), 0)")
RECORDED_SHARE = M("Learners with attendance", "countIf(att_recorded_days > 0) / nullIf(count(), 0)")
AVG_DAYS = M("Average days recorded", "avgIf(att_recorded_days, att_recorded_days > 0)")
DAYS_REC = M("Days recorded", "max(att_recorded_days)")
DAYS_MISSED = M("Days missed", "max(att_missed_days)")
LEARNER_RATE = M("Attendance rate", "max(attendance_rate)")
# Survival (cohort dataset, learners admitted to Standard 1, as at the current year)
def reached(k, std):
    return (f"countIf(is_current_year = 1 AND years_since_entry >= {k} AND highest_grade_reached >= {std}) / "
            f"nullIf(countIf(is_current_year = 1 AND years_since_entry >= {k}), 0)")
SURV5 = M("Reached Standard 5", reached(4, 5))
SURV8 = M("Reached Standard 8", reached(7, 8))
COMPLETED = M("Standard 8 completed", "countIf(is_current_year = 1 AND years_since_entry >= 8 AND completed_before = 1) / "
                                      "nullIf(countIf(is_current_year = 1 AND years_since_entry >= 8), 0)")

CLOSED = F("is_closed = 1")
PAST = F("is_current_year = 0")      # the academic year in progress is left out of rates
FIRST_STD = F("entry_grade_num = 1")

COMMON = {"color_scheme": "supersetColors", "extra_form_data": {}, "dashboards": []}


def big_number(metric, filters=(), fmt="SMART_NUMBER", subtitle=""):
    return {"viz_type": "big_number_total", "metric": metric, "adhoc_filters": list(filters),
            "header_font_size": 0.4, "subtitle": subtitle, "subtitle_font_size": 0.15,
            "y_axis_format": fmt, "time_format": "smart_date", **COMMON}


def trend(metric, filters=(), fmt=".1%", subtitle=""):
    return {"viz_type": "big_number", "metric": metric, "adhoc_filters": list(filters),
            "x_axis": "academic_year_start_date", "time_grain_sqla": "P1Y", "aggregation": "LAST_VALUE",
            "compare_lag": 1, "compare_suffix": "on the previous year", "show_timestamp": False,
            "show_trend_line": True, "start_y_axis_at_zero": True, "rolling_type": "None",
            "header_font_size": 0.35, "subtitle": subtitle, "subtitle_font_size": 0.15,
            "y_axis_format": fmt, "time_format": "%Y", **COMMON}


def bar(x, metrics, groupby=(), filters=(), horizontal=False, stack=None, contribution=None, fmt="SMART_NUMBER",
        sort_by=None, sort_asc=True, show_value=False, x_title="", y_title="", legend=True, limit=10000):
    p = {"viz_type": "echarts_timeseries_bar", "x_axis": x, "metrics": list(metrics), "groupby": list(groupby),
         "adhoc_filters": list(filters), "order_desc": True, "row_limit": limit, "truncate_metric": True,
         "show_empty_columns": True, "comparison_type": "values", "annotation_layers": [],
         "orientation": "horizontal" if horizontal else "vertical", "x_axis_title": x_title,
         "x_axis_title_margin": 30 if x_title else 15, "y_axis_title": y_title, "y_axis_title_margin": 30 if y_title else 15,
         "y_axis_title_position": "Left", "sort_series_type": "name", "sort_series_ascending": True,
         "show_legend": legend and (bool(groupby) or len(metrics) > 1), "legendType": "plain", "legendOrientation": "top",
         "x_axis_time_format": "smart_date", "xAxisLabelRotation": 0, "y_axis_format": fmt, "y_axis_bounds": [None, None],
         "truncateXAxis": True, "rich_tooltip": True, "tooltipTimeFormat": "smart_date", "show_value": show_value,
         "only_total": True, "stack": stack, "contributionMode": contribution, "xAxisForceCategorical": True,
         "zoomable": False, **COMMON}
    if sort_by and not groupby:
        p["x_axis_sort"] = sort_by
        p["x_axis_sort_asc"] = sort_asc
    return p


def line(x, metrics, groupby=(), filters=(), fmt=".0%", x_title="", y_title=""):
    return {"viz_type": "echarts_timeseries_line", "x_axis": x, "metrics": list(metrics), "groupby": list(groupby),
            "adhoc_filters": list(filters), "order_desc": True, "row_limit": 10000, "truncate_metric": True,
            "show_empty_columns": True, "comparison_type": "values", "annotation_layers": [],
            "x_axis_title": x_title, "x_axis_title_margin": 30 if x_title else 15, "y_axis_title": y_title,
            "y_axis_title_margin": 30 if y_title else 15, "y_axis_title_position": "Left",
            "sort_series_type": "name", "sort_series_ascending": True, "seriesType": "line", "markerEnabled": True,
            "markerSize": 6, "show_legend": True, "legendType": "plain", "legendOrientation": "top",
            "x_axis_time_format": "smart_date", "y_axis_format": fmt, "y_axis_bounds": [0, None],
            "truncateYAxis": False, "rich_tooltip": True, "tooltipTimeFormat": "smart_date", "xAxisForceCategorical": True,
            "zoomable": False, **COMMON}


def table_agg(groupby, metrics, filters=(), sort=None, limit=25, formats=None, asc=False, search=False):
    cfg = {k: {"d3NumberFormat": v} for k, v in (formats or {}).items()}
    cfg.update({c: {"customColumnName": NAMES[c]} for c in groupby if isinstance(c, str) and c in NAMES})
    return {"viz_type": "table", "query_mode": "aggregate", "groupby": list(groupby), "metrics": list(metrics),
            "all_columns": [], "percent_metrics": [], "adhoc_filters": list(filters), "timeseries_limit_metric": sort,
            "order_desc": not asc, "row_limit": limit, "server_pagination": False, "server_page_length": 10,
            "include_search": search, "show_cell_bars": True, "color_pn": False, "allow_rearrange_columns": False,
            "table_timestamp_format": "%Y-%m-%d", "column_config": cfg, "conditional_formatting": [], **COMMON}


def table_raw(columns, filters=(), order=None, limit=1000):
    return {"viz_type": "table", "query_mode": "raw", "groupby": [], "metrics": [], "all_columns": list(columns),
            "percent_metrics": [], "adhoc_filters": list(filters),
            "order_by_cols": [json.dumps([c, asc]) for c, asc in (order or [])], "row_limit": limit,
            "server_pagination": False, "server_page_length": 10, "include_search": True, "show_cell_bars": False,
            "allow_rearrange_columns": False, "table_timestamp_format": "%Y-%m-%d",
            "column_config": {c: {"customColumnName": NAMES[c]} for c in columns if c in NAMES},
            "conditional_formatting": [], **COMMON}


# ---------------------------------------------------------------- charts
# key: (title, dataset, params, description)
CH = {}
def chart(key, title, ds, params, desc=None):
    CH[key] = (title, ds, params, desc)

# Overview
EXPECTED = "entry_grade_num + years_since_entry"
STDS, YEARS = range(1, 9), range(0, 10)       # Standards 1-8; up to 10 academic years from the intake year
MATRIX_SEL = '[data-test-chart-name="Cohort flow matrix"]'
# The dashboard CSS styles the matrix. Superset sanitises chart HTML (no class or style attributes), so the template
# marks cells by tag: <strong> on track, <em> below the expected standard, <i> a standard with no record.
MATRIX_CSS = "\n".join(f"{MATRIX_SEL} {rule}" for rule in [
    "p { margin: 0 0 8px 0; color: #5f6368; font-size: 13px; }",
    "p + p { border: 1px solid #e3e5e8; border-radius: 6px; padding: 8px 12px; font-size: 12px; margin-bottom: 12px; }",
    "p b { color: #0b7a68; font-size: 15px; margin-right: 4px; }",
    "p ins { color: #e0611b; font-size: 15px; text-decoration: none; margin: 0 4px 0 18px; }",
    "table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid #e3e5e8; border-radius: 8px; overflow: hidden; font-size: 13px; }",
    "th { background: #f4f5f7; color: #5f6368; font-size: 11px; font-weight: 600; letter-spacing: .04em; padding: 10px; text-align: center; border-bottom: 1px solid #dcdfe4; white-space: nowrap; }",
    "th:first-child { text-align: left; padding-left: 14px; }",
    "td { padding: 0; height: 38px; text-align: center; color: #9aa0a6; border-bottom: 1px solid #f0f1f3; border-left: 1px solid #eef0f2; }",
    "tbody tr:last-child td { border-bottom: 0; }",
    "td:first-child { text-align: left; padding: 0 14px; font-size: 12px; font-weight: 600; color: #3c4043; border-left: 0; white-space: nowrap; }",
    "td i { font-style: normal; color: #b4b8bd; }",
    "td strong { display: block; line-height: 38px; background: #e3f3f0; color: #0b7a68; font-weight: 700; }",
    "td em { font-style: normal; font-weight: 700; color: #e0611b; }",
])


def matrix_template():
    head = "".join(f"{{{{#if show_{k}}}}}<th>{{{{y_{k}}}}}</th>{{{{/if}}}}" for k in YEARS)
    rows = []
    for s_ in STDS:
        cells = []
        for k in YEARS:
            tag = "strong" if s_ >= 1 + k else "em"          # expected standard in year k is 1 + k
            cells.append(f"{{{{#if show_{k}}}}}{{{{#if n_{s_}_{k}}}}}<td><{tag}>{{{{n_{s_}_{k}}}}}</{tag}></td>"
                         f"{{{{else}}}}<td>-</td>{{{{/if}}}}{{{{/if}}}}")
        rows.append(f"<tr>{{{{#if r_{s_}}}}}<td>STD {s_}</td>{{{{else}}}}<td><i>STD {s_}</i></td>{{{{/if}}}}"
                    + "".join(cells) + "</tr>")
    return ("{{#each data}}"
            "<p>Tracks the learners admitted to Standard 1 in {{intake_year}}. Each cell is the number of them "
            "recorded in that standard and academic year.</p>"
            "<p><b>&#9632;</b>On track: the expected standard for that academic year"
            "<ins>&#9632;</ins>Below expected standard: the learner may have repeated, returned after an interruption or registered after the admission year"
            "<br>A dash means no record in that standard and year. It is not automatically a dropout or transfer.</p>"
            f"<table><thead><tr><th>STANDARD</th>{head}</tr></thead><tbody>" + "".join(rows) + "</tbody></table>"
            "{{/each}}")


def matrix():
    metrics = [M("intake_year", "any(cohort_year_label)")]
    metrics += [M(f"y_{k}", f"concat(toString(any(cohort_year_start) + {k - 1}), '-', toString(any(cohort_year_start) + {k}))")
                for k in YEARS]
    metrics += [M(f"show_{k}", f"toUInt8(any(cohort_year_start) + {k} <= any(current_year_start))") for k in YEARS]
    metrics += [M(f"r_{s_}", f"countIf(grade_num_in_year = {s_})") for s_ in STDS]
    metrics += [M(f"n_{s_}_{k}", f"countIf(grade_num_in_year = {s_} AND years_since_entry = {k})")
                for s_ in STDS for k in YEARS]
    return {"viz_type": "handlebars", "query_mode": "aggregate", "groupby": [], "metrics": metrics, "all_columns": [],
            "percent_metrics": [], "adhoc_filters": [FIRST_STD, F("is_enrolled = 1")], "row_limit": 10,
            "order_desc": True, "handlebarsTemplate": matrix_template(), "styleTemplate": "", **COMMON}


MATRIX_DESC = ("One Standard 1 intake, chosen by admission year with the Cohort filter; by default the intake due in "
               "the last standard this year, from its admission year to the current year. Each cell is the number of the intake's learners "
               "registered in that standard and academic year. On track: in the expected standard for the years since "
               "admission, or higher. Below expected: in a lower standard, after repeating, returning from an interruption "
               "or registering after the admission year. "
               "A blank cell means no registration in that standard and year; it is not in itself a dropout or transfer.")
chart("ov_matrix", "Cohort flow matrix", CF, matrix(), MATRIX_DESC)
chart("ov_learners", "Learners enrolled", LY, big_number(LEARNERS, subtitle="Learner-years in the selection"))
chart("ov_new", "New entrants", LY, big_number(LEARNERS, [F("entry_type = 'New entrant'")], subtitle="First registration in SEMIS"))
chart("ov_gpi", "Gender parity index", LY, big_number(GPI, fmt=".2f", subtitle="Female learners per male learner"))
chart("ov_awaiting", "Awaiting re-enrolment", LY,
      big_number(AWAITING, subtitle="Not yet registered this year"),
      "Learners whose next academic year has started less than 60 days ago and who have no registration in it yet.")
chart("ov_conf_rate", "Confirmed dropout rate", LY,
      trend(CONF_RATE, [CLOSED, PAST], subtitle="Last completed year, dropout final result"),
      "Learners whose final result is a dropout, as a share of learner-years with a known outcome. "
      "Completed academic years only: the year in progress is left out until it ends.")
chart("ov_promo_rate", "Promotion rate", LY,
      trend(PROMO_RATE, [CLOSED, PAST], subtitle="Last completed year, higher standard next year"),
      "Learners registered in a higher standard the next year, as a share of learner-years with a known outcome. "
      "Completed academic years only.")
chart("ov_pending", "Transfers awaiting approval", TR,
      big_number(TRANSFERS, [F("transfer_status = 'Pending'"), F("direction = 'Incoming'")], subtitle="Requests the receiving school has not decided"))
chart("ov_by_year", "Enrolment by academic year", LY,
      bar("academic_year_label", [LEARNERS], ["gender"], stack="Stack", x_title="Academic year"))
chart("ov_by_std", "Enrolment by standard", LY, bar("grade", [LEARNERS], ["gender"]))
chart("ov_by_district", "Enrolment by district", LY,
      bar("level3_name", [LEARNERS], horizontal=True, sort_by="Learners", sort_asc=True))

# Flow and dropout (closed learner-years only)
chart("fl_flow", "Learner flow by standard", LY,
      bar("grade", [LEARNERS], ["flow_status"], [CLOSED], stack="Stack", contribution="row", fmt=".0%"),
      "What happened to the learners of each standard in the following academic year.")
chart("fl_sankey", "Grade transitions", LY,
      {"viz_type": "sankey_v2", "source": "flow_from", "target": "flow_to", "metric": LEARNERS,
       "adhoc_filters": [CLOSED], "row_limit": 10000, **COMMON},
      "Use with one academic year selected.")
chart("fl_rates_year", "Dropout and non re-enrolment by year", LY,
      line("academic_year_label", [CONF_RATE, NRE_RATE], filters=[CLOSED, PAST], fmt=".1%"),
      "Completed academic years. Confirmed dropouts have a dropout final result. Not re-enrolled learners have no registration in the next year after the 60-day grace period; they include learners whose promotion was not recorded.")
chart("fl_rate_gender", "Confirmed dropout rate by gender", LY,
      line("academic_year_label", [CONF_RATE], ["gender"], [CLOSED, PAST], fmt=".1%"), "Completed academic years.")
chart("fl_reasons", "Dropout reasons", LY,
      bar("dropout_reason", [LEARNERS], filters=[F("flow_status = 'Dropped out'"), F("dropout_reason != ''")],
          horizontal=True, sort_by="Learners", sort_asc=True))
chart("fl_reasons_other", "Other dropout reasons, as written", LY,
      table_agg([COL("dropout_reason_other", "Reason as written")], [LEARNERS],
                [F("flow_status = 'Dropped out'"), F("dropout_reason_other != ''")], sort=LEARNERS, limit=100),
      "The text entered under \"specify\" with a dropout reason.")
chart("fl_age", "Dropout by age for grade", LY,
      bar("age_for_grade", [CONF_RATE, NRE_RATE], filters=[CLOSED, F("age_for_grade != 'Not recorded'")],
          horizontal=True, stack="Stack", fmt=".0%"),
      "Over-age learners drop out more often.")
chart("fl_district", "Dropout by district", LY,
      bar("level3_name", [CONF_RATE, NRE_RATE], filters=[CLOSED], horizontal=True, stack="Stack", fmt=".0%"))
chart("fl_schools", "Schools with the highest dropout", LY,
      table_agg(["school_name", "level3_name", "level4_name"], [LEARNERS, CONF_DROPOUTS, NOT_REENROLLED, DROP_RATE],
                [CLOSED, F("count() >= 20", "HAVING")], sort=DROP_RATE, limit=25,
                formats={"Dropout rate (all)": ".1%"}),
      "Schools with at least 20 learner-years with a known outcome.")

# Cohorts (entered at Standard 1)
chart("co_matrix", "Cohort flow matrix", CF, matrix(), MATRIX_DESC)
chart("co_retention", "Cohort retention", CO,
      {"viz_type": "pivot_table_v2", "groupbyRows": [COL("cohort_year_label", "Admission cohort")], "groupbyColumns": [COL("years_since_entry", "Years since admission")],
       "metrics": [RETENTION], "metricsLayout": "COLUMNS", "adhoc_filters": [FIRST_STD], "row_limit": 10000,
       "order_desc": True, "aggregateFunction": "Sum", "valueFormat": ".0%", "date_format": "smart_date",
       "rowOrder": "key_a_to_z", "colOrder": "key_a_to_z", "rowTotals": False, "colTotals": False,
       "rowSubTotals": False, "colSubTotals": False, "transposePivot": False, "combineMetric": False,
       "conditional_formatting": [{"colorScheme": "colorPrimary", "column": "Retention rate", "operator": "None",
                                   "useGradient": True}], **COMMON},
      "Rows are admission cohorts, columns are years since admission; each cell is the share still in school or completed.")
chart("co_survival", "Survival curves", CO,
      {**line("years_since_entry", [RETENTION], ["cohort_year_label"], [FIRST_STD], x_title="Years since admission"),
       "y_axis_bounds": [0, 1]})
chart("co_status", "Cohort status by years since admission", CO,
      bar("years_since_entry", [COHORT_N], ["cohort_status"], [FIRST_STD], stack="Stack", contribution="row",
          fmt=".0%", x_title="Years since admission"))
chart("co_on_track", "On-track rate", CO,
      {**line("years_since_entry", [ON_TRACK], ["cohort_year_label"], [FIRST_STD], x_title="Years since admission"),
       "y_axis_bounds": [0, 1]},
      "In the expected standard for the years since admission, or higher. After Standard 8, learners who completed it "
      "on time count as on track; learners who completed it late, or left, do not.")
chart("co_reached", "Survival to Standard 5 and 8, and completion", CO,
      bar(COL("cohort_year_label", "Admission cohort"), [SURV5, SURV8, COMPLETED],
          filters=[FIRST_STD, F("countIf(is_current_year = 1 AND years_since_entry >= 4) >= 20", "HAVING")], fmt=".0%",
          x_title="Admission cohort", show_value=True),
      "Share of each Standard 1 intake that has reached Standard 5 (intakes admitted at least 4 years ago), Standard 8 "
      "(at least 7 years ago) or completed Standard 8 (at least 8 years ago), as at this year. Repeaters count once they "
      "get there, so the most recent intakes in each group look lower until their repeaters catch up. Learners who moved "
      "to a school outside SEMIS count as not reached. Intakes admitted less than 4 years ago, or with fewer than 20 "
      "learners, are left out.")

# Inclusion (learner-years in the selected academic year)
NEW_STD1 = [F("entry_type = 'New entrant'"), F("grade_num = 1")]
chart("in_ecd", "New entrants with ECD", LY,
      big_number(ECD_SHARE, NEW_STD1, fmt=".0%", subtitle="New Standard 1 entrants who attended ECD"),
      "Share of new Standard 1 entrants who attended early childhood development (ECD), among those whose ECD "
      "attendance is recorded.")
chart("in_sne", "Learners with special needs", LY,
      big_number(SNE, subtitle="A special need or disability recorded"))
chart("in_orphans", "Orphans", LY, big_number(ORPHANS, subtitle="Maternal, paternal or double orphans"))
chart("in_readmitted", "Re-admitted learners", LY,
      big_number(READMITTED, subtitle="Back after a dropout or a year away"),
      "Learners registered this year after a dropout, or after an academic year with no registration.")
chart("in_sne_std", "Learners with special needs by standard", LY, bar("grade", [SNE], ["gender"]))
chart("in_sne_type", "Special needs by type", LY,
      bar(COL("disability", "Special need"), [LEARNERS], filters=[F("has_disability = 1")], horizontal=True,
          sort_by="Learners", sort_asc=True))
chart("in_ecd_std1", "New entrants by ECD attendance", LY,
      bar(COL("attended_ecd", "Attended ECD"), [LEARNERS], ["gender"], NEW_STD1, stack="Stack"),
      "New Standard 1 entrants. Not recorded: the ECD question was left blank.")
chart("in_orphan_type", "Orphans by type", LY,
      bar(COL("orphan_status", "Orphan status"), [LEARNERS], ["gender"], [F("is_orphan = 1")], stack="Stack"))
chart("in_readmit_std", "Re-admitted learners by standard", LY, bar("grade", [READMITTED], ["gender"]))
chart("in_village", "Enrolment by village", LY,
      table_agg([COL("village", "Village"), "school_name"], [LEARNERS, FEMALE, MALE], sort=LEARNERS, limit=500,
                search=True),
      "Village as recorded on the learner profile, with spacing and capitals tidied. Spellings are not checked "
      "against a village list.")

# Attendance
CHRONIC_NOTE = ("Missed 10% or more of the days with attendance recorded (absent or on leave), among learners with at "
                "least 20 days recorded. Both values are set in semis_config.")
chart("at_rate", "Attendance rate", AT,
      big_number(ATT_RATE, fmt=".1%", subtitle="Days present or late, of days recorded"),
      "Learner-days marked present or late, as a share of learner-days with attendance recorded.")
chart("at_chronic", "Chronically absent", LY,
      big_number(CHRONIC_SHARE, fmt=".1%", subtitle="Missed 10% or more of recorded days"), CHRONIC_NOTE)
chart("at_chronic_n", "Chronically absent learners", LY,
      big_number(CHRONIC_N, subtitle="Learners on the follow-up list below"), CHRONIC_NOTE)
chart("at_schools", "Schools recording attendance", LY,
      big_number(SCHOOLS_RECORDING, fmt=".0%", subtitle="Schools with any attendance recorded"))
chart("at_week", "Attendance rate by week", AT,
      {**line("attendance_date", [ATT_RATE], ["gender"], fmt=".0%"),
       "time_grain_sqla": "P1W", "xAxisForceCategorical": False, "x_axis_time_format": "%d %b"},
      "Each point is a week, labelled with its Monday.")
chart("at_std", "Attendance rate by standard", AT, bar("grade", [ATT_RATE], ["gender"], fmt=".0%"))
chart("at_district", "Attendance rate by district", AT,
      bar("level3_name", [ATT_RATE], horizontal=True, fmt=".0%", sort_by="Attendance rate", sort_asc=True))
chart("at_school", "Attendance recording by school", LY,
      table_agg(["school_name", "level3_name"], [LEARNERS, RECORDED_SHARE, AVG_DAYS, ATT_RATE_LY],
                sort=RECORDED_SHARE, asc=True, limit=500, search=True,
                formats={"Learners with attendance": ".0%", "Average days recorded": ".0f", "Attendance rate": ".1%"}),
      "Schools with the fewest learners recorded come first. A school with no attendance recorded shows 0%.")
chart("at_chronic_list", "Chronically absent learners", LY,
      table_agg(["school_name", "learner_id", "grade"], [DAYS_REC, DAYS_MISSED, LEARNER_RATE],
                [F("is_chronically_absent = 1")], sort=LEARNER_RATE, asc=True, limit=1000, search=True,
                formats={"Attendance rate": ".0%"}),
      "Follow-up list, lowest attendance first. " + CHRONIC_NOTE)

# Admissions
chart("ad_month", "Admissions by month", AD,
      {**bar("admission_month", [ADMISSIONS], ["gender"], [F("admission_month IS NOT NULL")], stack="Stack"),
       "time_grain_sqla": "P1M", "xAxisForceCategorical": False, "x_axis_time_format": "%b %Y"},
      "By recorded admission date. Learners with no admission date are counted under No admission date.")
chart("ad_no_date", "No admission date", AD,
      big_number(ADMISSIONS, [F("admission_date IS NULL")], subtitle="Admitted learners with no admission date recorded"),
      "Their admission year is taken from the first enrolment instead.")
chart("ad_std", "Admissions by entry standard", AD,
      bar("entry_grade", [ADMISSIONS], filters=[F("admission_status != 'Admitted, not enrolled'")]),
      "Entry above Standard 1 means late entry or a transfer from outside SEMIS.")
chart("ad_status", "Admission status", AD, bar("admission_status", [ADMISSIONS], horizontal=True, sort_by="Admissions"))
chart("ad_not_enrolled", "Admitted but not enrolled", AD,
      table_raw(["school_name", "level3_name", "learner_id", "admission_date", "age_at_admission"],
                [F("admission_status = 'Admitted, not enrolled'")], order=[("admission_date", True)]),
      "Follow-up list: admitted learners with no registration.")

# Transfers
chart("tr_district", "Approved transfers in and out by district", TR,
      bar("level3_name", [TRANSFERS], ["direction"], [F("transfer_status = 'Approved'")]))
chart("tr_status", "Transfer requests by status", TR, bar("transfer_status", [TRANSFERS]))
chart("tr_reasons", "Transfer reasons", TR,
      bar("transfer_reason", [TRANSFERS], filters=[F("direction = 'Outgoing'"), F("transfer_reason != ''")],
          horizontal=True, sort_by="Transfers", sort_asc=True))
chart("tr_pending", "Pending transfers", TR,
      table_raw(["school_name", "counterpart_school_name", "learner_id", "grade", "requested_date", "days_pending"],
                [F("transfer_status = 'Pending'"), F("direction = 'Incoming'")], order=[("days_pending", False)]),
      "Requests awaiting the receiving school's decision.")

# The formula of each chart, shown in a small text box under it (a MARKDOWN in the chart's COLUMN). Superset 6.1 does
# not show chart descriptions on dashboards, and the dashboard layout, unlike charts, is replaced on import, so the
# formulas can change without new chart copies. Filters narrow both sides of every ratio. "Known outcome" = the learner-year's next step is known (is_closed = 1).
KNOWN = "learner-years with a known outcome"
FORMULA = {
    "ov_learners": "number of learner-years: one per learner per academic year, at the school of registration.",
    "ov_new": "learners whose registration this year is their first in SEMIS.",
    "ov_gpi": "female learners \u00f7 male learners.",
    "ov_awaiting": "last year's learners with no registration yet in the new year, while it is less than 60 days old.",
    "ov_conf_rate": f"learner-years with a dropout final result \u00f7 {KNOWN}. Last completed academic year.",
    "ov_promo_rate": f"learner-years registered in a higher standard the next year \u00f7 {KNOWN}. Last completed academic year.",
    "ov_pending": "incoming transfer requests the receiving school has not decided.",
    "ov_by_year": "learners per academic year, by gender. All years.",
    "ov_by_std": "learners per standard, by gender.",
    "ov_by_district": "learners per district.",
    "fl_flow": f"learner-years with each outcome next year \u00f7 {KNOWN}, per standard.",
    "fl_sankey": "learners from their standard this year to their outcome next year.",
    "fl_rates_year": f"confirmed dropout rate = dropout final results \u00f7 {KNOWN}; not re-enrolled rate = no "
                     f"registration anywhere in the next year after its first 60 days \u00f7 {KNOWN}. The second "
                     "includes learners whose promotion was not recorded.",
    "fl_rate_gender": f"dropout final results \u00f7 {KNOWN}, by gender. Completed academic years.",
    "fl_reasons": "confirmed dropouts by the reason recorded with the final result.",
    "fl_reasons_other": "confirmed dropouts by the text entered under \"specify\".",
    "fl_age": f"confirmed dropouts, and learners not re-enrolled, \u00f7 {KNOWN}, by age for grade "
              "(age at the start of the year minus the official age for the standard, 6 + standard \u2212 1).",
    "fl_district": f"confirmed dropouts, and learners not re-enrolled, \u00f7 {KNOWN}, by district.",
    "fl_schools": f"dropout rate (all) = (confirmed dropouts + not re-enrolled) \u00f7 {KNOWN}. "
                  "Schools with at least 20 such learner-years.",
    "co_retention": "learners of the intake in school or who completed Standard 8 \u00f7 learners of the intake whose "
                    "status is known, by years since admission. Rows are admission cohorts.",
    "co_survival": "learners of the intake in school or who completed Standard 8 \u00f7 learners of the intake whose "
                   "status is known, by years since admission.",
    "co_on_track": "learners in the expected standard (entry standard + years since admission) or higher, or who "
                   "completed Standard 8 on time, \u00f7 learners of the intake whose status is known.",
    "co_reached": "learners whose highest standard is 5 or more \u00f7 learners of the intake, for intakes admitted at "
                  "least 4 years ago; the same with Standard 8 and 7 years; completed = learners who completed "
                  "Standard 8 \u00f7 learners of intakes admitted at least 8 years ago. Intakes of 20 or more.",
    "co_status": "learners of the intakes in each status \u00f7 all learners of the intakes, by years since admission.",
    "in_ecd": "new Standard 1 entrants who attended ECD \u00f7 new Standard 1 entrants with ECD attendance recorded (Yes or No).",
    "in_sne": "learners whose disability value is recorded and is not None.",
    "in_orphans": "learners recorded as maternal, paternal or double orphans.",
    "in_readmitted": "learners registered this year, after their first year, who dropped out last year or had no "
                     "registration last year.",
    "in_sne_std": "learners with a special need recorded, per standard and gender.",
    "in_sne_type": "learners with a special need recorded, by the type recorded.",
    "in_ecd_std1": "new Standard 1 entrants by ECD attendance (Yes, No, Not recorded) and gender.",
    "in_orphan_type": "orphans by type and gender.",
    "in_readmit_std": "re-admitted learners per standard and gender.",
    "in_village": "learners per village and school, from the village on the learner profile.",
    "at_rate": "(days present + days late) \u00f7 days with attendance recorded, over all learners.",
    "at_chronic": "learners who missed 10% or more of their recorded days (absent or leave) \u00f7 learners with at "
                  "least 20 days recorded.",
    "at_chronic_n": "learners with at least 20 days recorded who missed 10% or more of them.",
    "at_schools": "schools with attendance recorded for at least one learner \u00f7 schools with learners.",
    "at_week": "(days present + days late) \u00f7 days recorded, per week and gender.",
    "at_std": "(days present + days late) \u00f7 days recorded, per standard and gender.",
    "at_district": "(days present + days late) \u00f7 days recorded, per district.",
    "at_school": "learners with attendance = learners with at least one day recorded \u00f7 learners; attendance "
                 "rate = days attended \u00f7 days recorded.",
    "at_chronic_list": "learners with at least 20 days recorded who missed 10% or more; attendance rate = days "
                       "attended \u00f7 days recorded. Lowest first.",
    "ad_month": "admitted learners by month of the recorded admission date, by gender.",
    "ad_no_date": "admitted learners with no admission date recorded. Their admission year comes from the first enrolment.",
    "ad_std": "admitted learners by the standard of their first registration. Above Standard 1 means late entry "
              "or a transfer from outside SEMIS.",
    "ad_status": "admitted learners by when they were first registered: in the admission year, later, or not yet.",
    "ad_not_enrolled": "admitted learners with no registration, for follow-up.",
    "tr_district": "approved transfers, counted at the sending school (Outgoing) and the receiving school (Incoming).",
    "tr_status": "transfer requests by status, each counted once.",
    "tr_reasons": "transfers by reason, counted once at the sending school.",
    "tr_pending": "incoming requests the receiving school has not decided, oldest first.",
}
assert set(CH) - set(FORMULA) == {"ov_matrix", "co_matrix"}, set(CH) - set(FORMULA)

KEYS = list(CH)
OLD_ID = {k: i + 1 for i, k in enumerate(KEYS)}

# ---------------------------------------------------------------- layout
TABS = [
    ("overview", "Overview",
     "**Learners** counts learner-years: one per learner per academic year, at the school of registration. "
     "Rates use only learner-years whose outcome is known. The **Cohort flow matrix** follows the intake chosen in the "
     "Cohort filter.",
     [[("ov_learners", 3), ("ov_new", 3), ("ov_gpi", 3), ("ov_awaiting", 3)],
      [("ov_matrix", 12)],
      [("ov_conf_rate", 4), ("ov_promo_rate", 4), ("ov_pending", 4)],
      [("ov_by_year", 6), ("ov_by_std", 6)],
      [("ov_by_district", 12)]]),
    ("flow", "Flow and dropout",
     "Pick an **Outcome year** (completed academic years only) to see what happened to its learners the following year. "
     "**Confirmed dropouts** have a dropout final result. **Not re-enrolled** learners have no registration in the next "
     "year once its first 60 days have passed; they include learners whose promotion was never recorded, so check them "
     "before reading them as dropouts.",
     [[("fl_flow", 6), ("fl_sankey", 6)],
      [("fl_rates_year", 6), ("fl_rate_gender", 6)],
      [("fl_reasons", 6), ("fl_reasons_other", 6)],
      [("fl_age", 6), ("fl_district", 6)],
      [("fl_schools", 12)]]),
    ("cohorts", "Cohorts",
     "Learners admitted to Standard 1, grouped by admission year and followed year by year. The **Cohort flow matrix** follows one intake, chosen with the "
     "**Cohort** filter; the other charts compare all intakes. Not affected by the Academic year, Outcome year and "
     "Standard filters.",
     [[("co_matrix", 12)],
      [("co_retention", 12)],
      [("co_survival", 6), ("co_on_track", 6)],
      [("co_reached", 12)],
      [("co_status", 12)]]),
    ("inclusion", "Inclusion",
     "Learners in the selected academic year. **Special needs**, **orphan status**, **ECD attendance** and **village** "
     "come from the learner profile. **Re-admitted** learners are registered after a dropout or after a year with no "
     "registration.",
     [[("in_ecd", 3), ("in_sne", 3), ("in_orphans", 3), ("in_readmitted", 3)],
      [("in_sne_std", 6), ("in_sne_type", 6)],
      [("in_ecd_std1", 6), ("in_orphan_type", 6)],
      [("in_readmit_std", 6), ("in_village", 6)]]),
    ("attendance", "Attendance",
     "Daily attendance in the selected academic year. **Attendance rate** counts present and late as attended. "
     "**Chronically absent** learners missed 10% or more of their recorded days, once at least 20 days are recorded. "
     "Check **Attendance recording by school** before comparing schools: rates only cover the days a school recorded.",
     [[("at_rate", 3), ("at_chronic", 3), ("at_chronic_n", 3), ("at_schools", 3)],
      [("at_week", 6), ("at_std", 6)],
      [("at_district", 6), ("at_school", 6)],
      [("at_chronic_list", 12)]]),
    ("admissions", "Admissions", None,
     [[("ad_month", 6), ("ad_std", 6)],
      [("ad_no_date", 4), ("ad_status", 8)],
      [("ad_not_enrolled", 12)]]),
    ("transfers", "Transfers",
     "Each transfer is counted once. Approved transfers appear at the sending school as Outgoing and at the receiving school as Incoming.",
     [[("tr_district", 6), ("tr_status", 6)],
      [("tr_reasons", 5), ("tr_pending", 7)]]),
]
# The formula box reads as a caption under its chart: no card, small grey text.
FORMULA_CSS = "\n".join([
    '[id^="MARKDOWN-f-"] .dashboard-component-chart-holder { background: transparent; box-shadow: none; padding: 0 6px; }',
    '[id^="MARKDOWN-f-"] { font-size: 12px; line-height: 17px; color: #5f6368; }',
    '[id^="MARKDOWN-f-"] p { margin: 0; }',
    '[id^="MARKDOWN-f-"] strong { color: #3c4043; }'])


def formula_height(text, width):
    """Grid units (8 px) for a formula caption of the given column width: 12 px text, about 14 characters per
    column unit on a laptop screen, 17 px a line."""
    per_line = max(12, width * 14)
    lines = -(-len(text) // per_line)
    return -(-(lines * 17 + 10) // 8)


HEIGHT = {"big_number_total": 34, "big_number": 46, "table": 70, "pivot_table_v2": 42, "co_matrix": 74, "ov_matrix": 74,
          "fl_reasons_other": 52, "ad_no_date": 40, "in_village": 52, "at_school": 52}

pos = {"DASHBOARD_VERSION_KEY": "v2",
       "ROOT_ID": {"type": "ROOT", "id": "ROOT_ID", "children": ["TABS-semis"]},
       "HEADER_ID": {"id": "HEADER_ID", "type": "HEADER", "meta": {"text": "SEMIS Learners"}},
       "TABS-semis": {"type": "TABS", "id": "TABS-semis", "children": [], "parents": ["ROOT_ID"], "meta": {}}}
tab_of = {}
for tkey, ttitle, note, rows in TABS:
    tid = f"TAB-{tkey}"
    pos["TABS-semis"]["children"].append(tid)
    tparents = ["ROOT_ID", "TABS-semis"]
    pos[tid] = {"type": "TAB", "id": tid, "children": [], "parents": tparents,
                "meta": {"text": ttitle, "defaultText": "Tab title", "placeholder": "Tab title"}}
    allrows = ([[("__md__", 12)]] if note else []) + rows
    for r_i, row in enumerate(allrows):
        rid = f"ROW-{tkey}-{r_i}"
        pos[tid]["children"].append(rid)
        rparents = tparents + [tid]
        pos[rid] = {"type": "ROW", "id": rid, "children": [], "parents": rparents,
                    "meta": {"background": "BACKGROUND_TRANSPARENT"}}
        # formula boxes in one row share a height, so the charts above them line up
        fh = max([formula_height("**Formula:** " + FORMULA[k], w) for k, w in row if k in FORMULA] or [0])
        for key, width in row:
            if key == "__md__":
                mid = f"MARKDOWN-{tkey}"
                pos[rid]["children"].append(mid)
                pos[mid] = {"type": "MARKDOWN", "id": mid, "children": [], "parents": rparents + [rid],
                            "meta": {"width": 12, "height": 11, "code": note}}
                continue
            title, ds, params, desc = CH[key]
            cid = f"CHART-{key}"
            tab_of[key] = tkey
            parent, cparents = rid, rparents + [rid]
            if key in FORMULA:        # chart and its formula stacked in one column
                col = f"COLUMN-{key}"
                pos[rid]["children"].append(col)
                pos[col] = {"type": "COLUMN", "id": col, "children": [cid, f"MARKDOWN-f-{key}"], "parents": list(cparents),
                            "meta": {"width": width, "background": "BACKGROUND_TRANSPARENT"}}
                cparents = cparents + [col]
                pos[f"MARKDOWN-f-{key}"] = {"type": "MARKDOWN", "id": f"MARKDOWN-f-{key}", "children": [],
                                            "parents": list(cparents),
                                            "meta": {"width": width, "height": fh,
                                                     "code": "**Formula:** " + FORMULA[key][0].upper() + FORMULA[key][1:]}}
            else:
                pos[rid]["children"].append(cid)
            pos[cid] = {"type": "CHART", "id": cid, "children": [], "parents": list(cparents),
                        "meta": {"chartId": OLD_ID[key], "uuid": CU(key), "width": width,
                                 "height": HEIGHT.get(key, HEIGHT.get(params["viz_type"], 52)), "sliceName": title}}

# ---------------------------------------------------------------- native filters
def ids(pred):
    return [OLD_ID[k] for k in KEYS if pred(k)]

def nf(fid, name, column, ds, multi=True, parents=(), excluded=(), first=False, asc=True, desc="", sort_metric=None):
    return {"id": fid, "name": name, "filterType": "filter_select", "type": "NATIVE_FILTER", "description": desc,
            "targets": [{"column": {"name": column}, "datasetUuid": ds}],
            "controlValues": {"enableEmptyFilter": first, "defaultToFirstItem": first, "multiSelect": multi,
                              "searchAllOptions": False, "inverseSelection": False, "sortAscending": asc,
                              **({"sortMetric": sort_metric} if sort_metric else {})},
            "defaultDataMask": {"extraFormData": {}, "filterState": {}, "ownState": {}},
            "cascadeParentIds": list(parents), "scope": {"rootPath": ["ROOT_ID"], "excluded": list(excluded)}}

TRENDS = ("ov_conf_rate", "ov_promo_rate", "ov_by_year", "ov_awaiting", "fl_rates_year", "fl_rate_gender")
MATRICES = ("ov_matrix", "co_matrix")
year_excluded = ids(lambda k: k in TRENDS or k in MATRICES or tab_of[k] in ("cohorts", "flow"))
outcome_excluded = ids(lambda k: tab_of[k] != "flow" or k in TRENDS)
std_excluded = ids(lambda k: k in MATRICES or tab_of[k] in ("cohorts", "admissions", "transfers"))
filters = [
    nf("NATIVE_FILTER-division", "Division", "level2_name", LY),
    nf("NATIVE_FILTER-district", "District", "level3_name", LY, parents=["NATIVE_FILTER-division"]),
    nf("NATIVE_FILTER-zone", "Zone", "level4_name", LY, parents=["NATIVE_FILTER-district"]),
    nf("NATIVE_FILTER-school", "School", "school_name", LY, parents=["NATIVE_FILTER-zone"]),
    {**nf("NATIVE_FILTER-year", "Academic year", "academic_year_label", LY, multi=False, first=True, asc=False,
          excluded=year_excluded, desc="Defaults to the latest academic year. Trend charts and the Cohorts tab show all years."),
     "requiredFirst": True},
    {**nf("NATIVE_FILTER-outcome-year", "Outcome year", "academic_year_label", LY, multi=False, first=True, asc=False,
          excluded=outcome_excluded,
          desc="Flow and dropout tab: completed academic years. Defaults to the latest; the year in progress is left out."),
     "requiredFirst": True, "adhoc_filters": [F("is_closed = 1"), PAST], "time_range": "No filter"},
    {**nf("NATIVE_FILTER-cohort", "Cohort", "intake", CF, multi=False, first=True, asc=False, sort_metric="intake_order",
          excluded=ids(lambda k: k not in MATRICES),
          desc="Cohort flow matrix: the admission year of the Standard 1 intake to follow, with the standard it is "
               "due in this year. Defaults to the intake due in the last standard."),
     "requiredFirst": True, "adhoc_filters": [F("entry_grade_num = 1")], "time_range": "No filter"},
    nf("NATIVE_FILTER-gender", "Gender", "gender", LY),
    nf("NATIVE_FILTER-standard", "Standard", "grade", LY, excluded=std_excluded,
       desc="Applies to the Overview and Flow and dropout tabs."),
]

label_colors = {
    "Female": "#2a78d6", "Male": "#eb6834", "Not recorded": "#898781",
    "Completed": "#4a3aa7", "Dropped out": "#e34948", "Not re-enrolled": "#eda100", "Promoted": "#2a78d6",
    "Repeated": "#1baf7a", "Moved down a grade": "#898781",
    "In school (same school)": "#2a78d6", "In school (other school)": "#1baf7a", "Out of school": "#e34948",
    "Awaiting re-enrolment": "#c3c2b7", "Incoming": "#1baf7a", "Outgoing": "#4a3aa7",
    "Approved": "#0ca30c", "Pending": "#fab219", "Rejected": "#d03b3b", "Reproved": "#d03b3b", "Cancelled": "#898781",
    "Confirmed dropout rate": "#e34948", "Not re-enrolled rate": "#eda100",
    "Yes": "#1baf7a", "No": "#e34948",
    "Reached Standard 5": "#2a78d6", "Reached Standard 8": "#1baf7a", "Standard 8 completed": "#4a3aa7",
}
metadata = {"color_scheme": "supersetColors", "label_colors": label_colors, "shared_label_colors": [],
            "color_scheme_domain": [], "cross_filters_enabled": False, "refresh_frequency": 0,
            "timed_refresh_immune_slices": [], "expanded_slices": {}, "default_filters": "{}",
            "chart_configuration": {}, "native_filter_configuration": filters,
            "global_chart_configuration": {"scope": {"rootPath": ["ROOT_ID"], "excluded": []}}}

# ---------------------------------------------------------------- write zip
root = "semis_learner_dashboard"
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr(f"{root}/metadata.yaml", yaml.safe_dump({"version": "1.0.0", "type": "Dashboard",
                                                        "timestamp": "2026-10-01T12:00:00+00:00"}, sort_keys=False))
    src = glob.glob(os.path.join(EXPORT, "*"))[0]
    for f in glob.glob(os.path.join(src, "databases", "*.yaml")) + glob.glob(os.path.join(src, "datasets", "*", "*.yaml")):
        z.writestr(f"{root}/" + os.path.relpath(f, src), open(f).read())
    co_file = glob.glob(os.path.join(src, "datasets", "*", "semis_cohort_view*.yaml"))[0]
    co = yaml.safe_load(open(co_file))
    extra_cols = [("intake", "Cohort", "String"), ("due_standard", None, "Int32"),
                  ("current_year_start", None, "Int32"), ("final_grade_num", None, "Int32")]
    cf = {**co, "table_name": CF_NAME, "main_dttm_col": None,
          "description": "Cohort view with an admission-year label for the Cohort filter (SEMIS learner dashboard).",
          "sql": CF_SQL, "uuid": CF,
          "metrics": co["metrics"] + [{**co["metrics"][0], "metric_name": "intake_order", "verbose_name": "Intake order",
                                       "metric_type": None, "expression": CF_ORDER}],
          "columns": [c for c in co["columns"] if c["column_name"] not in {n for n, _, _ in extra_cols}]
                     + [{**co["columns"][0], "column_name": n, "verbose_name": v, "is_dttm": False, "type": t,
                         "expression": None} for n, v, t in extra_cols]}
    z.writestr(f"{root}/datasets/{os.path.basename(os.path.dirname(co_file))}/{CF_NAME}.yaml",
               yaml.safe_dump(cf, sort_keys=False, allow_unicode=True))
    at = {**co, "table_name": AT_NAME, "main_dttm_col": "attendance_date",
          "description": "Daily attendance by school, standard and gender (SEMIS learner dashboard).",
          "sql": AT_SQL, "uuid": AT, "metrics": co["metrics"],
          "columns": [{**co["columns"][0], "column_name": n, "verbose_name": None, "is_dttm": t == "Date", "type": t,
                       "expression": None} for n, t in AT_COLS]}
    z.writestr(f"{root}/datasets/{os.path.basename(os.path.dirname(co_file))}/{AT_NAME}.yaml",
               yaml.safe_dump(at, sort_keys=False, allow_unicode=True))
    for key in KEYS:
        title, ds, params, desc = CH[key]
        cu = CU(key)
        doc = {"slice_name": title, "description": desc, "certified_by": None, "certification_details": None,
               "viz_type": params["viz_type"], "params": params, "query_context": QC.get(cu), "cache_timeout": None,
               "uuid": cu, "version": "1.0.0", "dataset_uuid": ds}
        z.writestr(f"{root}/charts/{key}_{OLD_ID[key]}.yaml", yaml.safe_dump(doc, sort_keys=False, allow_unicode=True))
    dash = {"dashboard_title": "SEMIS Learners", "description": None, "css": MATRIX_CSS + "\n" + FORMULA_CSS, "slug": "semis-learners",
            "certified_by": None, "certification_details": None, "published": True, "uuid": U("dashboard"),
            "position": pos, "metadata": metadata, "version": "1.0.0"}
    z.writestr(f"{root}/dashboards/SEMIS_Learners.yaml", yaml.safe_dump(dash, sort_keys=False, allow_unicode=True))
open(OUT, "wb").write(buf.getvalue())
print(f"{len(KEYS)} charts, dashboard {U('dashboard')}, query contexts: {sum(1 for k in KEYS if QC.get(CU(k)))}")
