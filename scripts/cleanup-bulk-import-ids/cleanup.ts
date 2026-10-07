/**
 * Deletes learners (tracked entities) left behind by a failed bulk import, so the admission file can be
 * imported again: learners with no enrollment at all, and learners whose ID attribute was read as
 * "2.0195E+13" instead of the full number. See README.md.
 *
 *   DHIS2_BASE_URL=https://server/dhis DHIS2_TOKEN=... npx tsx scripts/cleanup-bulk-import-ids/cleanup.ts [options]
 *
 * Options
 *   --dry-run                 list and validate only (default): tracker importMode=VALIDATE
 *   --commit                  delete the listed tracked entities
 *   --section student|staff   section of semis/values to use (default student)
 *   --attribute <uid>         ID attribute to check (default: the section's admission studentIdentifier)
 *   --org-unit <uid>          only tracked entities owned in this org unit and below
 *   --created-after <date>    only tracked entities created on or after this date (YYYY-MM-DD)
 *   --only no-enrollment|scientific-id   only one of the two checks (default: both)
 *   --report <file>           CSV report path (default cleanup-report-<timestamp>.csv)
 */
import { writeFileSync } from 'node:fs'
import { deletePayload, selectBroken, type Selected, type TrackedEntity } from './select'

const PAGE_SIZE = 100
const FIELDS = 'trackedEntity,orgUnit,createdAt,deleted,attributes[attribute,displayName,value],' +
    'enrollments[enrollment,program,status,deleted,events[event]]'

interface Options { commit: boolean, section: string, attribute?: string, orgUnit?: string, createdAfter?: string, only?: 'no-enrollment' | 'scientific-id', report: string }

function parseArgs(argv: string[]): Options {
    const options: Options = { commit: false, section: 'student', report: `cleanup-report-${new Date().toISOString().replace(/[:.]/g, '-')}.csv` }
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
        else if (arg === '--section') options.section = value()
        else if (arg === '--attribute') options.attribute = value()
        else if (arg === '--org-unit') options.orgUnit = value()
        else if (arg === '--report') options.report = value()
        else if (arg === '--only') {
            const only = value()
            if (only !== 'no-enrollment' && only !== 'scientific-id') throw new Error('--only must be no-enrollment or scientific-id')
            options.only = only
        }
        else if (arg === '--created-after') {
            options.createdAfter = value()
            if (!/^\d{4}-\d{2}-\d{2}$/.test(options.createdAfter)) throw new Error('--created-after must be YYYY-MM-DD')
        } else throw new Error(`Unknown option ${arg}`)
    }
    if (dryRun && options.commit) throw new Error('Use either --dry-run or --commit, not both')
    return options
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
        // The tracker answers 409 with a report when objects are rejected; that is a result, not a failure
        if (!response.ok && !(response.status === 409 && json?.validationReport)) {
            throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} failed: ${response.status} ${json?.message ?? response.statusText}`)
        }
        return json
    }
}

type Api = ReturnType<typeof client>

// Org units to search: the given one, otherwise the user's search and capture org units. The server
// needs at least one org unit when searching by tracked entity type, so ACCESSIBLE alone is not enough.
async function searchRoots(api: Api, orgUnit?: string): Promise<string[]> {
    if (orgUnit) return [orgUnit]
    const me = await api('me?fields=organisationUnits[id],teiSearchOrganisationUnits[id]')
    const ids = [...(me?.teiSearchOrganisationUnits ?? []), ...(me?.organisationUnits ?? [])].map((o: any) => o?.id).filter(Boolean)
    const unique = [...new Set<string>(ids)]
    if (!unique.length) throw new Error('The token user has no org units; pass --org-unit <uid>')
    return unique
}

// Query by tracked entity type, not program: learners without an enrollment are not returned by a
// program query. Newest first, so paging stops once records are older than --created-after.
async function findCandidates(api: Api, trackedEntityType: string, orgUnits: string[], createdAfter?: string) {
    const all = new Map<string, TrackedEntity>()
    for (let page = 1; ; page++) {
        const params = new URLSearchParams({
            trackedEntityType, page: String(page), pageSize: String(PAGE_SIZE), order: 'createdAt:desc', fields: FIELDS,
            orgUnit: orgUnits.join(';'), orgUnitMode: 'DESCENDANTS',
        })
        const response = await api(`tracker/trackedEntities?${params}`)
        const teis: TrackedEntity[] = response?.trackedEntities ?? response?.instances ?? []
        for (const t of teis) all.set(t.trackedEntity, t)
        process.stdout.write(`\r  scanned ${all.size} tracked entities`)
        const oldest = (teis[teis.length - 1]?.createdAt ?? '').slice(0, 10)
        if (teis.length < PAGE_SIZE || (createdAfter && oldest && oldest < createdAfter)) {
            process.stdout.write('\n')
            return [...all.values()]
        }
    }
}

async function deleteTrackedEntities(api: Api, selected: Selected[], commit: boolean) {
    const params = new URLSearchParams({ importStrategy: 'DELETE', atomicMode: 'OBJECT', importMode: commit ? 'COMMIT' : 'VALIDATE', async: 'false', reportMode: 'FULL' })
    const report = await api(`tracker?${params}`, { method: 'POST', body: deletePayload(selected) })
    const errors = new Map<string, string>()
    for (const error of report?.validationReport?.errorReports ?? []) {
        errors.set(error.uid, [errors.get(error.uid), `${error.errorCode}: ${error.message}`].filter(Boolean).join(' | '))
    }
    return errors
}

const csv = (value: unknown) => { const s = String(value ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

async function main() {
    const options = parseArgs(process.argv.slice(2))
    const api = client()
    console.log(`Mode: ${options.commit ? 'COMMIT (deleting)' : 'DRY RUN (VALIDATE)'}`)

    const sections = await api('dataStore/semis/values') as any[]
    const section = sections?.find(s => s?.key === options.section)
    if (!section) throw new Error(`No ${options.section} section in semis/values`)
    const trackedEntityType = section.trackedEntityType
    const attribute = options.attribute ?? section.admission?.studentIdentifier
    if (!trackedEntityType) throw new Error(`semis/values > ${options.section} has no trackedEntityType`)
    if (!attribute) throw new Error('No ID attribute: pass --attribute <uid> (admission.studentIdentifier is not set)')
    console.log(`Tracked entity type ${trackedEntityType}, ID attribute ${attribute}` +
        `${options.orgUnit ? `, org unit ${options.orgUnit}` : ''}${options.createdAfter ? `, created on or after ${options.createdAfter}` : ''}`)

    const roots = await searchRoots(api, options.orgUnit)
    if (!options.orgUnit) console.log(`Searching the token user's org units: ${roots.join(', ')}`)
    const candidates = await findCandidates(api, trackedEntityType, roots, options.createdAfter)
    const selected = selectBroken(candidates, attribute, options.createdAfter, {
        noEnrollment: options.only !== 'scientific-id', scientificId: options.only !== 'no-enrollment',
    })
    const count = (r: string) => selected.filter(s => s.reasons.includes(r as any)).length
    console.log(`Found ${selected.length} to delete: ${count('NO_ENROLLMENT')} without any enrollment, ${count('ID_IN_SCIENTIFIC_NOTATION')} with an ID in scientific notation`)

    const lines = ['tracked_entity,org_unit,created_at,id_value,enrollments,events,reasons,attributes,result']
    let failed = 0
    if (selected.length) {
        const errors = new Map<string, string>()
        for (let i = 0; i < selected.length; i += 50) {
            const chunk = selected.slice(i, i + 50)
            for (const [uid, message] of await deleteTrackedEntities(api, chunk, options.commit)) errors.set(uid, message)
        }
        for (const s of selected) {
            const error = errors.get(s.trackedEntity)
            if (error) failed++
            const result = error ? `ERROR ${error}` : options.commit ? 'DELETED' : 'WOULD DELETE'
            lines.push([s.trackedEntity, s.orgUnit, s.createdAt, s.idValue, s.enrollments, s.events, s.reasons.join(' '), s.attributes, result].map(csv).join(','))
            console.log(`  ${s.trackedEntity}  ${s.createdAt.slice(0, 16)}  ${s.reasons.join(',')}  ${(s.idValue + ' ' + s.attributes).slice(0, 70)}  ${result}`)
        }
        const withData = selected.filter(s => s.enrollments || s.events).length
        if (withData) console.log(`Note: ${withData} of them have enrollments or events; deleting them needs the cascade delete authority.`)
    }
    writeFileSync(options.report, lines.join('\n') + '\n')
    console.log(`\n${options.commit ? 'Deleted' : 'Would delete'}: ${selected.length - failed}, errors: ${failed}. Report: ${options.report}`)
    process.exitCode = failed ? 2 : 0
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
})
