/**
 * Reports enrollment problems on a SEMIS server and, when asked, fixes the safe ones. See README.md.
 *
 *   DHIS2_BASE_URL=https://server/dhis DHIS2_TOKEN=... npx tsx scripts/check-enrollments/check.ts [options]
 *
 * Options
 *   --org-unit <uid>       only learners owned in this org unit and below (default: everything accessible)
 *   --program student|staff   section of semis/values (default student)
 *   --fix-event-dates      re-date events outside their enrollment's academic year, and term and
 *                          final-result events not on their term end / year end
 *   --fix-status           set the status a final result gives (CANCELLED for a dropout, else COMPLETED)
 *   --delete-empty         delete empty enrollments (no events at all) of learners who have a proper one
 *   --commit               save the fixes; without it the fixes are only validated (importMode=VALIDATE)
 *   --report <file>        CSV report (default enrollment-check-<timestamp>.csv)
 *
 * Without --fix-event-dates, --fix-status or --delete-empty it only reads and reports.
 */
import { writeFileSync } from 'node:fs'
import { getAcademicYearOptions, type CalendarEntry } from '../../src/libs/functions/src/utils/enrollment/enrollmentLifecycle'
import { checkLearner, fixPayloads, type CheckConfig, type Finding, type Learner } from './checks'

const PAGE_SIZE = 100
const FIELDS = 'trackedEntity,enrollments[enrollment,program,status,orgUnit,enrolledAt,occurredAt,deleted,' +
    'events[event,enrollment,program,programStage,orgUnit,occurredAt,scheduledAt,status,deleted,dataValues[dataElement,value]]]'

interface Options { orgUnit?: string, program: string, fixEventDates: boolean, fixStatus: boolean, deleteEmpty: boolean, commit: boolean, report: string }

function parseArgs(argv: string[]): Options {
    const o: Options = { program: 'student', fixEventDates: false, fixStatus: false, deleteEmpty: false, commit: false, report: `enrollment-check-${new Date().toISOString().replace(/[:.]/g, '-')}.csv` }
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        const value = () => { const next = argv[++i]; if (!next || next.startsWith('--')) throw new Error(`${arg} needs a value`); return next }
        if (arg === '--org-unit') o.orgUnit = value()
        else if (arg === '--program') o.program = value()
        else if (arg === '--fix-event-dates') o.fixEventDates = true
        else if (arg === '--fix-status') o.fixStatus = true
        else if (arg === '--delete-empty') o.deleteEmpty = true
        else if (arg === '--commit') o.commit = true
        else if (arg === '--report') o.report = value()
        else throw new Error(`Unknown option ${arg}`)
    }
    if (o.commit && !o.fixEventDates && !o.fixStatus && !o.deleteEmpty) throw new Error('--commit needs --fix-event-dates, --fix-status and/or --delete-empty')
    return o
}

function client() {
    const baseUrl = process.env.DHIS2_BASE_URL?.replace(/\/+$/, '')
    const token = process.env.DHIS2_TOKEN
    if (!baseUrl || !token) throw new Error('Set DHIS2_BASE_URL and DHIS2_TOKEN')
    // The token is only sent in this header; errors report the path, never the headers
    return async function api(path: string, init: { method?: string, body?: unknown } = {}) {
        const response = await fetch(`${baseUrl}/api/${path}`, {
            method: init.method ?? 'GET',
            headers: { Authorization: `ApiToken ${token}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
            body: init.body ? JSON.stringify(init.body) : undefined,
        })
        const text = await response.text()
        const json = text ? JSON.parse(text) : undefined
        if (!response.ok && !(response.status === 409 && json?.validationReport)) {
            throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} failed: ${response.status} ${json?.message ?? response.statusText}`)
        }
        return json
    }
}
type Api = ReturnType<typeof client>

async function* pages(api: Api, program: string, orgUnit?: string) {
    for (let page = 1; ; page++) {
        const params = new URLSearchParams({
            program, page: String(page), pageSize: String(PAGE_SIZE), order: 'createdAt:asc', fields: FIELDS,
            ...(orgUnit ? { orgUnit, orgUnitMode: 'DESCENDANTS' } : { orgUnitMode: 'ACCESSIBLE' }),
        })
        const response = await api(`tracker/trackedEntities?${params}`)
        const teis: Learner[] = response?.trackedEntities ?? response?.instances ?? []
        if (teis.length) yield teis
        if (teis.length < PAGE_SIZE) return
    }
}

async function save(api: Api, body: Record<string, unknown[]>, strategy: 'UPDATE' | 'DELETE', commit: boolean) {
    const params = new URLSearchParams({ importStrategy: strategy, atomicMode: 'OBJECT', importMode: commit ? 'COMMIT' : 'VALIDATE', async: 'false', reportMode: 'FULL' })
    const report = await api(`tracker?${params}`, { method: 'POST', body })
    const errors = new Map<string, string>()
    for (const e of report?.validationReport?.errorReports ?? []) errors.set(e.uid, [errors.get(e.uid), `${e.errorCode}: ${e.message}`].filter(Boolean).join(' | '))
    return errors
}

const csv = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const pad = (n: number) => String(n).padStart(2, '0')
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

async function main() {
    const o = parseArgs(process.argv.slice(2))
    const api = client()
    const fixing = o.fixEventDates || o.fixStatus || o.deleteEmpty
    console.log(`Mode: ${!fixing ? 'REPORT ONLY' : o.commit ? 'COMMIT (fixing)' : 'DRY RUN of the fixes (VALIDATE)'}${o.orgUnit ? `, org unit ${o.orgUnit}` : ''}`)

    const [sections, calendarKey] = await Promise.all([api('dataStore/semis/values'), api('dataStore/semis/schoolCalendar')])
    const section = (sections as any[]).find(s => s?.key === o.program)
    if (!section?.program) throw new Error(`No ${o.program} section in semis/values`)
    const yearDE = section.registration?.academicYear || calendarKey?.academicYear
    const program = await api(`programs/${section.program}?fields=id,programStages[programStageDataElements[dataElement[id,optionSet[options[code,name]]]]]`)
    const cfg: CheckConfig = {
        registrationStage: section.registration?.programStage,
        academicYearDataElement: yearDE,
        attendanceStage: section.attendance?.programStage,
        transferStage: section.transfer?.programStage,
        performanceStages: (section.performance?.programStages ?? []).map((x: any) => x?.programStage),
        finalResultStage: section['final-result']?.programStage,
        finalResultStatusDataElement: section['final-result']?.status,
        dropoutStatusValues: section['final-result']?.dropoutStatusValues ?? [],
        calendar: (calendarKey?.schoolCalendar ?? []) as CalendarEntry[],
        options: getAcademicYearOptions(program, yearDE),
        today: today(),
    }

    const findings: Finding[] = []
    let learners = 0
    for await (const page of pages(api, section.program, o.orgUnit)) {
        learners += page.length
        for (const learner of page) findings.push(...checkLearner(learner, cfg, { deleteEmpty: o.deleteEmpty, fixEventDates: o.fixEventDates, fixStatus: o.fixStatus }))
        process.stdout.write(`\r  checked ${learners} learners, ${findings.length} findings`)
    }
    process.stdout.write('\n')

    // Fixes, in chunks; errors are reported per enrollment or event
    const errors = new Map<string, string>()
    const { deleteEnrollments, events, enrollments } = fixPayloads(findings)
    for (let i = 0; i < enrollments.length; i += 100) {
        for (const [k, v] of await save(api, { enrollments: enrollments.slice(i, i + 100) }, 'UPDATE', o.commit)) errors.set(k, v)
    }
    for (let i = 0; i < events.length; i += 100) {
        for (const [k, v] of await save(api, { events: events.slice(i, i + 100) }, 'UPDATE', o.commit)) errors.set(k, v)
    }
    for (let i = 0; i < deleteEnrollments.length; i += 100) {
        for (const [k, v] of await save(api, { enrollments: deleteEnrollments.slice(i, i + 100) }, 'DELETE', o.commit)) errors.set(k, v)
    }

    const lines = ['type,tracked_entity,enrollment,event,detail,fix,result']
    const counts = new Map<string, number>()
    for (const f of findings) {
        counts.set(f.type, (counts.get(f.type) ?? 0) + 1)
        const id = f.fix?.kind === 'UPDATE_EVENT_DATE' ? f.event : f.enrollment
        const fix = !f.fix ? '' : f.fix.kind === 'UPDATE_EVENT_DATE' ? `date -> ${f.fix.newDate}` : f.fix.kind === 'UPDATE_STATUS' ? `status -> ${f.fix.status}` : 'delete enrollment'
        const error = id ? errors.get(id) : undefined
        const result = !f.fix ? 'REPORTED' : error ? `ERROR ${error}` : o.commit ? 'FIXED' : 'WOULD FIX'
        lines.push([f.type, f.trackedEntity, f.enrollment, f.event, f.detail, fix, result].map(csv).join(','))
    }
    writeFileSync(o.report, lines.join('\n') + '\n')

    console.log(`\nLearners checked: ${learners}`)
    for (const type of ['EMPTY_ENROLLMENT', 'DUPLICATE_YEAR', 'MULTIPLE_ACTIVE', 'EVENT_DATE_OUTSIDE_YEAR', 'STAGE_EVENT_DATE', 'STATUS_NOT_MATCHING_RESULT']) console.log(`  ${type.padEnd(24)} ${counts.get(type) ?? 0}`)
    if (fixing) console.log(`Fixes ${o.commit ? 'saved' : 'validated'}: ${events.length} event date(s), ${enrollments.length} status(es), ${deleteEnrollments.length} empty enrollment(s) deleted; errors: ${errors.size}`)
    console.log(`Report: ${o.report}`)
    process.exitCode = errors.size ? 2 : 0
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
