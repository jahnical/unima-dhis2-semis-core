/**
 * Corrects enrollment statuses and dates on an existing SEMIS server, and optionally moves events
 * captured before a transfer back to the sending school. See README.md before running it.
 *
 *   DHIS2_BASE_URL=https://server/dhis DHIS2_TOKEN=... npx tsx scripts/migrate-enrollment-lifecycle/migrate.ts [options]
 *
 * Options
 *   --dry-run                  validate only (default): tracker importMode=VALIDATE
 *   --commit                   apply the changes
 *   --program student|staff|all   (default all)
 *   --org-unit <uid>           only tracked entities owned in this org unit and below
 *   --restore-transfer-history move events with data back to the school of origin
 *   --report <file>            CSV report path (default migration-report-<timestamp>.csv)
 */
import { writeFileSync } from 'node:fs'
import { getAcademicYearOptions, type CalendarEntry } from '../../src/libs/functions/src/utils/enrollment/enrollmentLifecycle'
import { planTrackedEntity, type MigrationConfig, type ReportRow, type TrackedEntity } from './plan'

const PAGE_SIZE = 100
const TRACKED_ENTITY_FIELDS = 'trackedEntity,enrollments[enrollment,program,status,orgUnit,enrolledAt,occurredAt,deleted,' +
    'events[event,enrollment,trackedEntity,program,programStage,orgUnit,occurredAt,scheduledAt,status,deleted,dataValues[dataElement,value]]]'

interface Options { commit: boolean, program: 'student' | 'staff' | 'all', orgUnit?: string, restoreTransferHistory: boolean, report: string }

function parseArgs(argv: string[]): Options {
    const options: Options = {
        commit: false, program: 'all', restoreTransferHistory: false,
        report: `migration-report-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
    }
    let dryRun = false
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        const value = () => {
            const next = argv[++i]
            if (!next || next.startsWith('--')) throw new Error(`${arg} needs a value`)
            return next
        }
        if (arg === '--dry-run') dryRun = true
        else if (arg === '--commit') options.commit = true
        else if (arg === '--restore-transfer-history') options.restoreTransferHistory = true
        else if (arg === '--org-unit') options.orgUnit = value()
        else if (arg === '--report') options.report = value()
        else if (arg === '--program') {
            const program = value()
            if (program !== 'student' && program !== 'staff' && program !== 'all') throw new Error('--program must be student, staff or all')
            options.program = program
        } else throw new Error(`Unknown option ${arg}`)
    }
    if (dryRun && options.commit) throw new Error('Use either --dry-run or --commit, not both')
    return options
}

function client() {
    const baseUrl = process.env.DHIS2_BASE_URL?.replace(/\/+$/, '')
    const token = process.env.DHIS2_TOKEN
    if (!baseUrl || !token) throw new Error('Set DHIS2_BASE_URL and DHIS2_TOKEN')

    // The token is only ever sent in this header; errors report the path, never the headers
    return async function api(path: string, init: { method?: string, body?: unknown } = {}) {
        const response = await fetch(`${baseUrl}/api/${path}`, {
            method: init.method ?? 'GET',
            headers: { Authorization: `ApiToken ${token}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
            body: init.body ? JSON.stringify(init.body) : undefined,
        })
        const text = await response.text()
        const json = text ? JSON.parse(text) : undefined
        // The tracker answers 409 with a report when objects are rejected; that is a result, not a failure
        if (!response.ok && !(response.status === 409 && json?.validationReport)) {
            throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} failed: ${response.status} ${json?.message ?? response.statusText}`)
        }
        return json
    }
}

type Api = ReturnType<typeof client>

async function* trackedEntityPages(api: Api, program: string, orgUnit?: string) {
    for (let page = 1; ; page++) {
        const params = new URLSearchParams({
            program, page: String(page), pageSize: String(PAGE_SIZE), order: 'createdAt:asc', fields: TRACKED_ENTITY_FIELDS,
            ...(orgUnit ? { orgUnits: orgUnit, orgUnitMode: 'DESCENDANTS' } : { orgUnitMode: 'ACCESSIBLE' }),
        })
        const response = await api(`tracker/trackedEntities?${params}`)
        const teis: TrackedEntity[] = response?.trackedEntities ?? response?.instances ?? []
        if (teis.length) yield teis
        if (teis.length < PAGE_SIZE) return
    }
}

// Tracker import; returns the error message per object uid
async function importPayload(api: Api, payload: Record<string, unknown[]>, commit: boolean) {
    const params = new URLSearchParams({ importStrategy: 'UPDATE', atomicMode: 'OBJECT', importMode: commit ? 'COMMIT' : 'VALIDATE', async: 'false', reportMode: 'FULL' })
    const report = await api(`tracker?${params}`, { method: 'POST', body: payload })
    const errors = new Map<string, string>()
    for (const error of report?.validationReport?.errorReports ?? []) {
        errors.set(error.uid, [errors.get(error.uid), `${error.errorCode}: ${error.message}`].filter(Boolean).join(' | '))
    }
    return errors
}

function sectionConfig(section: any, calendarKey: any, options: any[]): MigrationConfig {
    const transfer = section?.transfer
    return {
        program: section.program,
        registrationStage: section.registration?.programStage,
        academicYearDataElement: section.registration?.academicYear || calendarKey?.academicYear,
        finalResultStage: section['final-result']?.programStage,
        finalResultStatusDataElement: section['final-result']?.status,
        dropoutStatusValues: section['final-result']?.dropoutStatusValues ?? [],
        transferStage: transfer?.programStage,
        transferStatusDataElement: transfer?.status,
        transferDestinationDataElement: transfer?.destinySchool,
        approvedCode: transfer?.statusOptions?.find((x: any) => x?.configKey === 'approvedCode')?.code,
        currentAcademicYear: calendarKey?.defaults?.academicYear ?? section.defaults?.currentAcademicYear,
        calendar: (calendarKey?.schoolCalendar ?? []) as CalendarEntry[],
        options,
    }
}

const csv = (value: string) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

async function main() {
    const options = parseArgs(process.argv.slice(2))
    const api = client()
    const mode = options.commit ? 'COMMIT' : 'DRY RUN (VALIDATE)'
    console.log(`Mode: ${mode}${options.orgUnit ? `, org unit ${options.orgUnit}` : ''}${options.restoreTransferHistory ? ', restoring transfer history' : ''}`)

    const [sections, calendarKey] = await Promise.all([api('dataStore/semis/values'), api('dataStore/semis/schoolCalendar')])
    const selected = (sections as any[]).filter(s => s?.program && (options.program === 'all' || s.key === options.program))
    if (selected.length === 0) throw new Error(`No ${options.program} section in semis/values`)

    const lines = ['tracked_entity,object,id,field,old_value,new_value,reason,result']
    const summary = { trackedEntities: 0, enrollmentsUpdated: 0, eventsMoved: 0, findings: 0, errors: 0, transitions: new Map<string, number>() }

    for (const section of selected) {
        const program = await api(`programs/${section.program}?fields=id,programStages[programStageDataElements[dataElement[id,optionSet[options[code,name]]]]]`)
        const cfg = sectionConfig(section, calendarKey, getAcademicYearOptions(program, section.registration?.academicYear || calendarKey?.academicYear))
        console.log(`\n${section.key}: program ${cfg.program}, current academic year ${cfg.currentAcademicYear ?? '(none)'}`)

        for await (const page of trackedEntityPages(api, cfg.program, options.orgUnit)) {
            const plans = page.map(te => planTrackedEntity(te, cfg, { restoreTransferHistory: options.restoreTransferHistory }))
            summary.trackedEntities += page.length

            // All enrollment updates of a tracked entity travel together (closings before the ACTIVE one);
            // event moves go separately
            const enrollments = plans.flatMap(p => p.enrollments)
            const events = plans.flatMap(p => p.events)
            const enrollmentErrors = enrollments.length ? await importPayload(api, { enrollments }, options.commit) : new Map()
            const eventErrors = events.length ? await importPayload(api, { events }, options.commit) : new Map()

            for (const row of plans.flatMap(p => p.rows) as ReportRow[]) {
                const error = row.field ? (row.object === 'enrollment' ? enrollmentErrors : eventErrors).get(row.id) : undefined
                const result = !row.field ? 'REPORTED' : error ? `ERROR ${error}` : options.commit ? 'UPDATED' : 'VALID'
                if (!row.field) summary.findings++
                if (error) summary.errors++
                if (row.field === 'status' && !error) {
                    const key = `${row.oldValue} -> ${row.newValue}`
                    summary.transitions.set(key, (summary.transitions.get(key) ?? 0) + 1)
                }
                lines.push([row.trackedEntity, row.object, row.id, row.field, row.oldValue, row.newValue, row.reason, result].map(csv).join(','))
            }
            summary.enrollmentsUpdated += enrollments.filter(e => !enrollmentErrors.has(String(e.enrollment))).length
            summary.eventsMoved += events.filter(e => !eventErrors.has(String(e.event))).length
            process.stdout.write(`\r  ${summary.trackedEntities} tracked entities checked`)
        }
    }

    writeFileSync(options.report, lines.join('\n') + '\n')
    const verb = options.commit ? '' : ' (validated, not saved)'
    console.log(`\n\nSummary${verb}`)
    console.log(`  Tracked entities checked: ${summary.trackedEntities}`)
    console.log(`  Enrollments updated:      ${summary.enrollmentsUpdated}`)
    for (const [transition, count] of summary.transitions) console.log(`    status ${transition}: ${count}`)
    console.log(`  Events moved:             ${summary.eventsMoved}`)
    console.log(`  Findings (no change):     ${summary.findings}`)
    console.log(`  Rejected changes:         ${summary.errors}`)
    console.log(`  Report:                   ${options.report}`)
    if (summary.errors) process.exitCode = 2
}

main().catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
})
