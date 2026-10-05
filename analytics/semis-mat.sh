#!/usr/bin/env bash
# Hourly, ordered copies of the heavy SEMIS views, kept by ClickHouse itself (refreshable
# materialized views in database "semis_mat"). Each copy is rebuilt only after the copies it
# reads have finished, and each rebuild replaces the table in one step, so a dashboard never
# sees an empty or half-built table. AP's own schedules are not used.
#
# Run on the LXD host:
#   bash semis-mat.sh apply semis_bao_views.sql   build or replace the copies from the SQL file (checked first)
#   bash semis-mat.sh setup        build the copies from the views deployed in AP now
#   bash semis-mat.sh refresh      rebuild all copies now, in order (for example after a pipeline run)
#   bash semis-mat.sh status       last and next rebuild of each copy
#   SCHEDULE="EVERY 1 DAY OFFSET 5 HOUR" bash semis-mat.sh reschedule    change the schedule
#
# Undo an apply:  bash semis-mat.sh apply ~/semis-mat-apply-<time>/previous.sql
# Remove: in AP, paste the original SQL of the heavy views back, then
#   sudo lxc exec dhis2-bao -- docker exec -i analytics-platform-clickhouse-1 clickhouse-client -q 'DROP DATABASE semis_mat'
set -euo pipefail

BAO=dhis2-bao; CH=analytics-platform-clickhouse-1
SCHEDULE=${SCHEDULE:-"EVERY 1 HOUR OFFSET 30 MINUTE"}          # every hour at hh:30
NAMES=(config option_lookup stg_transfer stg_attendance stg_registration learner learner_year cohort attendance)   # build order
ALT=$(IFS='|'; echo "${NAMES[*]}")
BQ='`?'

ch()  { sudo lxc exec "$BAO" -- docker exec -i "$CH" sh -c 'clickhouse-client --user "${CLICKHOUSE_USER:-default}" \
          ${CLICKHOUSE_PASSWORD:+--password "$CLICKHOUSE_PASSWORD"} --multiquery'; }
chq() { ch <<<"$1"; }
die() { echo "STOPPED: $*" >&2; exit 1; }
err() { grep -o 'Code: [0-9]*\. DB::Exception: [^(]*' <<<"$1" | tail -n1 | cut -c1-220; }
is_heavy() { [[ " ${NAMES[*]} " == *" ${1#semis_} "* ]]; }

# Names from NAMES that the SQL in file $1 reads, other than $2 (as semis.semis_X_view or semis_mat.X).
deps_of() {
  local m out=()
  for m in "${NAMES[@]}"; do
    [[ "$m" == "$2" ]] && continue
    grep -Eq "(${BQ}semis${BQ}\.${BQ}semis_${m}_view|${BQ}semis_mat${BQ}\.${BQ}${m})${BQ}([^A-Za-z0-9_]|\$)" "$1" && out+=("semis_mat.$m")
  done
  local IFS=,; echo "${out[*]-}"
}
depends_clause() { [[ -n "$1" ]] && printf ' DEPENDS ON %s' "${1//,/, }"; return 0; }
# SQL of file $1 with the heavy views pointed at database $2 instead of the AP views.
point_at() { sed -E "s/${BQ}semis${BQ}\.${BQ}semis_(${ALT})_view${BQ}([^A-Za-z0-9_]|\$)/$2.\1\2/g" "$1" | sed -E '$ s/;?[[:space:]]*$//'; }
# One "-- @view NAME" block of a semis_bao_views.sql file: full-line comments removed, no final ";".
extract() {
  awk -v name="$2" '
    /^-- @view /             { on = ($3 == name); next }
    /^-- =====/              { on = 0; next }
    on && /^[[:space:]]*--/  { next }
    on                       { buf = buf $0 "\n" }
    END { sub(/[[:space:]]+$/, "", buf); sub(/;$/, "", buf); printf "%s\n", buf }' "$1"
}
# DDL of one copy: $1 database, $2 name, $3 SQL file, $4 REFRESH clause
copy_ddl() {
  printf 'CREATE MATERIALIZED VIEW %s.%s\nREFRESH %s\nENGINE = MergeTree ORDER BY tuple()\nEMPTY\nAS\n' "$1" "$2" "$4"
  point_at "$3" "$1"; printf ';\n'
}
build() {  # $1 database, $2 name: rebuild now, print rows
  local out t0; t0=$(date +%s)
  out=$(chq "SYSTEM REFRESH VIEW $1.$2; SYSTEM WAIT VIEW $1.$2; SELECT count() FROM $1.$2 FORMAT TSV" 2>&1) \
    || { echo "   $2: $(err "$out")" >&2; return 1; }
  printf '   %-17s %9s rows  %4ss\n' "$2" "$(tail -n1 <<<"$out")" $(( $(date +%s) - t0 ))
}
check_order() {  # $1 index in NAMES, $2 deps
  local e
  for e in ${2//,/ }; do
    [[ " ${NAMES[*]:0:$1} " == *" ${e#semis_mat.} "* ]] || die "semis_${NAMES[$1]} reads ${e#semis_mat.}, which is built after it."
  done
}
grant_readers() {  # users that read "semis" also need to read "semis_mat" once the AP views point there
  local u
  for u in $(chq "SELECT DISTINCT user_name FROM system.grants WHERE database = 'semis' AND user_name != '' AND user_name != currentUser() FORMAT TSVRaw" 2>/dev/null || true); do
    chq "GRANT SELECT ON semis_mat.* TO \`$u\`" >/dev/null 2>&1 && echo "    $u may now read semis_mat" \
      || echo "    note: could not let $u read semis_mat; if dashboards report missing privileges, grant it SELECT ON semis_mat.*"
  done
}
ap_switch_note() {  # which of the heavy AP views do not read their copy yet
  local n todo=()
  for n in "${NAMES[@]}"; do
    [[ "$(chq "SELECT position(as_select, 'semis_mat.$n') > 0 FROM system.tables WHERE database = 'semis' AND name = 'semis_${n}_view' FORMAT TSV")" == 1 ]] \
      || todo+=("$n")
  done
  [[ ${#todo[@]} -eq 0 ]] && { echo "All ${#NAMES[@]} heavy AP views already read their copies."; return; }
  echo "In AP, create or edit these views so each one's SQL is the line shown, keep Materialized off:"
  for n in "${todo[@]}"; do printf '   semis_%-17s SELECT * FROM semis_mat.%s\n' "$n" "$n"; done
}

# A ClickHouse view keeps the columns it had when it was created, so an AP view that reads a copy
# ("SELECT * FROM semis_mat.X") is re-created with the same SQL when the copy's columns change.
resync_ap_views() {
  local n sel same done=()
  for n in "${NAMES[@]}"; do
    sel=$(chq "SELECT any(as_select) FROM system.tables WHERE database = 'semis' AND name = 'semis_${n}_view' FORMAT TSVRaw")
    [[ "$sel" == "SELECT * FROM semis_mat.$n" ]] || continue
    same=$(chq "SELECT (SELECT groupArray((name, type)) FROM (SELECT name, type FROM system.columns
                         WHERE database = 'semis' AND table = 'semis_${n}_view' ORDER BY position))
                     = (SELECT groupArray((name, type)) FROM (SELECT name, type FROM system.columns
                         WHERE database = 'semis_mat' AND table = '$n' ORDER BY position)) FORMAT TSV")
    [[ "$same" == 1 ]] && continue
    chq "CREATE OR REPLACE VIEW semis.semis_${n}_view AS SELECT * FROM semis_mat.$n" && done+=("semis_$n")
  done
  [[ ${#done[@]} -gt 0 ]] && echo "    AP views re-created with the same SQL to pick up the new columns: ${done[*]}"
  return 0
}

refresh() { local n; echo "Rebuilding in order:"; for n in "${NAMES[@]}"; do build semis_mat "$n" || die "rebuilding semis_mat.$n failed."; done; }

status() {
  ch <<'SQL'
SELECT view, status, last_success_time, next_refresh_time, substring(exception, 1, 120) AS exception
FROM system.view_refreshes WHERE database = 'semis_mat'
ORDER BY indexOf(['config','option_lookup','stg_transfer','stg_attendance','stg_registration','learner','learner_year','cohort','attendance'], view)
FORMAT PrettyCompactMonoBlock
SQL
}

reschedule() {
  local n tmp d; tmp=$(mktemp)
  for n in "${NAMES[@]}"; do
    chq "SELECT as_select FROM system.tables WHERE database = 'semis_mat' AND name = '$n' FORMAT TSVRaw" > "$tmp"
    d=$(deps_of "$tmp" "$n")
    chq "ALTER TABLE semis_mat.$n MODIFY REFRESH $SCHEDULE$(depends_clause "$d")"
    echo "   $n: REFRESH $SCHEDULE$(depends_clause "$d")"
  done
  rm -f "$tmp"; status
}

apply() {
  local file=${1:-} n i d f dir names out same exists stale=()
  [[ -f "$file" ]] || die "usage: bash semis-mat.sh apply semis_bao_views.sql"
  dir="$HOME/semis-mat-apply-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$dir/file"
  names=$(grep -oE '^-- @view semis_[a-z_]+' "$file" | awk '{print $3}')
  for n in "${NAMES[@]}"; do grep -qx "semis_$n" <<<"$names" || die "semis_$n is missing from $file."; done
  for n in $names; do extract "$file" "$n" > "$dir/file/$n.sql"; [[ -s "$dir/file/$n.sql" ]] || die "$n in $file is empty."; done
  trap 'chq "DROP DATABASE IF EXISTS semis_mat_check" >/dev/null 2>&1 || true' EXIT
  chq "DROP DATABASE IF EXISTS semis_mat_check; CREATE DATABASE semis_mat_check"

  echo "1/4 Comparing the other views in the file with AP"
  for n in $names; do
    is_heavy "$n" && continue
    exists=$(chq "SELECT count() FROM system.tables WHERE database = 'semis' AND name = '${n}_view' FORMAT TSV")
    if ! out=$( { printf 'CREATE VIEW semis_mat_check.%s_view AS\n' "$n"; cat "$dir/file/$n.sql"; } | ch 2>&1 ); then
      printf '   %-26s cannot be created yet: %s\n' "$n" "$(err "$out")"; stale+=("$n"); continue
    fi
    same=$(chq "SELECT (SELECT any(as_select) FROM system.tables WHERE database = 'semis' AND name = '${n}_view')
                     = (SELECT any(as_select) FROM system.tables WHERE database = 'semis_mat_check' AND name = '${n}_view') FORMAT TSV")
    if [[ "$exists" == 0 ]]; then printf '   %-26s NOT IN AP: create it in AP from the file\n' "$n"; stale+=("$n")
    elif [[ "$same" == 1 ]]; then printf '   %-26s same as AP\n' "$n"
    else printf '   %-26s DIFFERENT: paste it from the file into AP\n' "$n"; stale+=("$n"); fi
  done

  echo "2/4 Building the new copies in a check database (nothing in use is changed)"
  for i in "${!NAMES[@]}"; do
    n=${NAMES[$i]}; f="$dir/file/semis_$n.sql"; d=$(deps_of "$f" "$n"); check_order "$i" "$d"
    out=$(copy_ddl semis_mat_check "$n" "$f" "EVERY 1 YEAR" | ch 2>&1) \
      || die "semis_$n in the file is not valid here: $(err "$out"). Nothing was changed.${stale:+ Update the AP views marked above first, then run apply again.}"
    build semis_mat_check "$n" \
      || die "semis_$n could not be built from the file. Nothing was changed.${stale:+ Update the AP views marked above first, then run apply again.}"
  done

  echo "3/4 Replacing the copies in semis_mat (dashboards may show errors for a few seconds)"
  if [[ "$(chq 'EXISTS DATABASE semis_mat FORMAT TSV')" == 1 ]]; then
    for n in "${NAMES[@]}"; do   # previous definitions, in the file format, for undo
      [[ "$(chq "EXISTS TABLE semis_mat.$n FORMAT TSV")" == 1 ]] || continue
      printf -- '-- @view semis_%s\n' "$n"
      chq "SELECT as_select FROM system.tables WHERE database = 'semis_mat' AND name = '$n' FORMAT TSVRaw" \
        | sed -E "s/${BQ}semis_mat${BQ}\.${BQ}(${ALT})${BQ}([^A-Za-z0-9_]|\$)/semis.semis_\1_view\2/g"
      printf ';\n\n'
    done > "$dir/previous.sql"
  fi
  chq "CREATE DATABASE IF NOT EXISTS semis_mat"
  : > "$dir/semis_mat.sql"
  for i in "${!NAMES[@]}"; do
    n=${NAMES[$i]}; f="$dir/file/semis_$n.sql"; d=$(deps_of "$f" "$n")
    copy_ddl semis_mat "$n" "$f" "$SCHEDULE$(depends_clause "$d")" >> "$dir/semis_mat.sql"
    out=$( { echo "DROP TABLE IF EXISTS semis_mat.$n SYNC;"; copy_ddl semis_mat "$n" "$f" "$SCHEDULE$(depends_clause "$d")"; } | ch 2>&1 ) \
      || die "replacing semis_mat.$n failed: $(err "$out"). Undo with: bash semis-mat.sh apply $dir/previous.sql"
    build semis_mat "$n" || die "rebuilding semis_mat.$n failed. Undo with: bash semis-mat.sh apply $dir/previous.sql"
  done
  grant_readers
  resync_ap_views

  echo "4/4 Done. ClickHouse rebuilds the copies $SCHEDULE, in order."
  if [[ -s "$dir/previous.sql" && "$(grep -c '^-- @view ' "$dir/previous.sql")" == "${#NAMES[@]}" ]]; then
    echo "To undo: bash semis-mat.sh apply $dir/previous.sql"
  fi
  ap_switch_note
  if [[ ${#stale[@]} -gt 0 ]]; then
    echo "Also paste these views from $file into AP: ${stale[*]}"
  fi
}

setup() {
  local n e d f i dir
  [[ "$(chq 'EXISTS DATABASE semis_mat FORMAT TSV')" == 0 ]] \
    || die "database semis_mat already exists. Use: bash semis-mat.sh apply semis_bao_views.sql"
  dir="$HOME/semis-mat-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$dir/original"

  echo "1/5 Reading the deployed view definitions"
  for n in "${NAMES[@]}"; do
    f="$dir/original/semis_$n.sql"
    e=$(chq "SELECT engine FROM system.tables WHERE database = 'semis' AND name = 'semis_${n}_view' FORMAT TSVRaw")
    [[ -n "$e" ]] || die "semis_$n is not in AP. Use: bash semis-mat.sh apply semis_bao_views.sql"
    [[ "$e" == View ]] || die "semis.semis_${n}_view is '$e', not a logical view. Turn off Materialized for semis_$n in AP, then run this again."
    chq "SELECT as_select FROM system.tables WHERE database = 'semis' AND name = 'semis_${n}_view' FORMAT TSVRaw" > "$f"
    [[ -s "$f" ]] || die "could not read the SQL of semis.semis_${n}_view."
    ! grep -q 'semis_mat' "$f" || die "semis_$n in AP already reads semis_mat. Restore its original SQL first."
  done
  echo "    saved to $dir/original/"

  echo "2/5 Writing $dir/semis_mat.sql"
  {
    echo "CREATE DATABASE IF NOT EXISTS semis_mat;"
    for i in "${!NAMES[@]}"; do
      n=${NAMES[$i]}; f="$dir/original/semis_$n.sql"; d=$(deps_of "$f" "$n"); check_order "$i" "$d"
      copy_ddl semis_mat "$n" "$f" "$SCHEDULE$(depends_clause "$d")"
    done
  } > "$dir/semis_mat.sql"

  echo "3/5 Creating the copies in ClickHouse"
  ch < "$dir/semis_mat.sql" || die "ClickHouse rejected $dir/semis_mat.sql (see above). Nothing in AP was changed. Drop semis_mat (see the top of this file) before running setup again."
  grant_readers

  echo "4/5 First build"
  refresh

  echo "5/5 Comparing each copy with its AP view (one at a time)"
  for n in "${NAMES[@]}"; do
    e=$(chq "SELECT (SELECT count() FROM semis_mat.$n), (SELECT count() FROM semis.semis_${n}_view),
                    (SELECT sum(cityHash64(*)) FROM semis_mat.$n) = (SELECT sum(cityHash64(*)) FROM semis.semis_${n}_view)
             FORMAT TSV" 2>&1) || e="not compared: $(err "$e")"
    read -r a b same <<<"$e" || true
    if [[ "${same:-}" == 1 ]]; then printf '   %-17s identical (%s rows)\n' "$n" "$a"
    elif [[ "$e" == not* ]]; then printf '   %-17s %s\n' "$n" "$e"
    else printf '   %-17s DIFFERENT: copy %s rows, view %s rows\n' "$n" "$a" "$b"; fi
  done

  echo; echo "Done. ClickHouse now rebuilds the copies $SCHEDULE, in order. The original SQL of the heavy views is in $dir/original/."
  ap_switch_note
}

case "${1:-}" in
  apply) apply "${2:-}" ;; setup) setup ;; refresh) refresh ;; status) status ;; reschedule) reschedule ;;
  *) sed -n '2,17p' "$0"; exit 1 ;;
esac
