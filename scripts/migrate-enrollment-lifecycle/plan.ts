/**
 * Works out, for one tracked entity, which enrollment statuses and dates to correct and (optionally)
 * which events to move back to the school where they were captured. Pure: no API calls.
 */
import {
    academicYearOf, academicYearOrder, getAcademicYearDates, statusForFinalResult,
    type CalendarEntry, type EnrollmentStatus, type ExistingEnrollment, type ExistingEvent,
} from '../../src/libs/functions/src/utils/enrollment/enrollmentLifecycle'
import type { YearOption } from '../../src/libs/functions/src/utils/validateEnrollmentYear'

export interface MigrationConfig {
    program: string
    registrationStage: string
    academicYearDataElement: string
    finalResultStage?: string
    finalResultStatusDataElement?: string
    dropoutStatusValues: string[]
    transferStage?: string
    transferStatusDataElement?: string
    transferDestinationDataElement?: string
    approvedCode?: string
    currentAcademicYear?: string
    calendar: CalendarEntry[]
    options: YearOption[]
}

export interface TrackedEntity {
    trackedEntity: string
    enrollments?: (ExistingEnrollment & { events?: ExistingEvent[] })[]
}

/** One row of the report. `field` is empty for findings that change nothing. */
export interface ReportRow {
    trackedEntity: string
    object: 'enrollment' | 'event'
    id: string
    field: string
    oldValue: string
    newValue: string
    reason: string
}

export interface TrackedEntityPlan {
    /** Enrollment updates, closings first so the payload never holds two ACTIVE enrollments. */
    enrollments: Record<string, unknown>[]
    /** Events whose org unit is restored (only with restoreTransferHistory). */
    events: Record<string, unknown>[]
    rows: ReportRow[]
}

const day = (value?: string) => value?.slice(0, 10)
const valueOf = (event: ExistingEvent | undefined, dataElement?: string) =>
    dataElement ? event?.dataValues?.find(dv => dv.dataElement === dataElement)?.value ?? undefined : undefined
const hasData = (event: ExistingEvent) =>
    (event.dataValues ?? []).some(dv => dv.value !== undefined && dv.value !== null && String(dv.value) !== '')
const time = (value?: string) => (value ? new Date(value).getTime() : NaN)

export function planTrackedEntity(te: TrackedEntity, cfg: MigrationConfig, { restoreTransferHistory = false } = {}): TrackedEntityPlan {
    const rows: ReportRow[] = []
    const note = (object: ReportRow['object'], id: string, reason: string) =>
        rows.push({ trackedEntity: te.trackedEntity, object, id, field: '', oldValue: '', newValue: '', reason })
    const years = { calendars: cfg.calendar, options: cfg.options }
    const current = academicYearOrder(cfg.currentAcademicYear, years)

    const live = (te.enrollments ?? []).filter(e => !e.deleted && (!e.program || e.program === cfg.program))
    const info = live.map(e => {
        const events = (e.events ?? []).filter(ev => !ev.deleted)
        const registered = events.some(ev => ev.programStage === cfg.registrationStage)
        const yearText = academicYearOf({ ...e, events }, cfg.registrationStage, cfg.academicYearDataElement) ?? undefined
        const finalEvent = events.find(ev => ev.programStage === cfg.finalResultStage && valueOf(ev, cfg.finalResultStatusDataElement))
        return {
            e, events, registered, yearText,
            order: academicYearOrder(yearText, years),
            decision: valueOf(finalEvent, cfg.finalResultStatusDataElement) as string | undefined,
        }
    })
    const latest = Math.max(...info.map(i => i.order ?? -Infinity))

    // Target status per enrollment (step 4)
    const target = new Map<string, { status: string, reason: string }>()
    for (const i of info) {
        const id = i.e.enrollment
        if (i.decision) {
            const status = statusForFinalResult(i.decision, cfg.dropoutStatusValues)
            target.set(id, { status, reason: status === 'CANCELLED' ? `final result "${i.decision}" is a dropout` : `final result "${i.decision}"` })
        } else if (i.e.status === 'CANCELLED') {
            target.set(id, { status: 'CANCELLED', reason: 'cancelled without final result: kept' })
        } else if (!i.registered) {
            if (live.length === 1) target.set(id, { status: 'ACTIVE', reason: 'admission-only enrollment, the only one' })
            else target.set(id, { status: 'COMPLETED', reason: 'admission-only enrollment next to other enrollments (not deleted)' })
        } else if (i.order === undefined) {
            target.set(id, { status: i.e.status, reason: `academic year "${i.yearText ?? ''}" not recognised: status kept` })
        } else if (i.order === latest && (current === undefined || i.order >= current)) {
            target.set(id, { status: 'ACTIVE', reason: `latest academic year ${i.yearText}` })
        } else {
            target.set(id, { status: 'COMPLETED', reason: `closed without final result (${i.yearText})` })
        }
    }

    // At most one ACTIVE: the latest year wins; among duplicates keep the one already ACTIVE, else the latest enrolledAt
    const active = info.filter(i => target.get(i.e.enrollment)?.status === 'ACTIVE')
    if (active.length > 1) {
        const winner = [...active].sort((a, b) =>
            (b.order ?? -Infinity) - (a.order ?? -Infinity)
            || Number(b.e.status === 'ACTIVE') - Number(a.e.status === 'ACTIVE')
            || (time(b.e.enrolledAt) || 0) - (time(a.e.enrolledAt) || 0))[0]
        for (const i of active) {
            if (i === winner) continue
            target.set(i.e.enrollment, { status: 'COMPLETED', reason: `another enrollment (${winner.e.enrollment}, ${winner.yearText ?? 'no academic year'}) stays ACTIVE` })
        }
    }

    const enrollments: Record<string, unknown>[] = []
    for (const i of info) {
        const e = i.e
        const next: { status?: string, enrolledAt?: string, occurredAt?: string } = { status: target.get(e.enrollment)!.status, enrolledAt: e.enrolledAt, occurredAt: e.occurredAt }
        const change = (field: 'status' | 'enrolledAt' | 'occurredAt', value: string | undefined, reason: string) => {
            next[field] = value
            rows.push({ trackedEntity: te.trackedEntity, object: 'enrollment', id: e.enrollment, field, oldValue: String(e[field] ?? ''), newValue: String(value ?? ''), reason })
        }
        if (next.status !== e.status) change('status', next.status, target.get(e.enrollment)!.reason)
        else if (target.get(e.enrollment)!.reason.endsWith('kept')) note('enrollment', e.enrollment, target.get(e.enrollment)!.reason)
        if (!i.registered && live.length > 1) note('enrollment', e.enrollment, 'admission-only enrollment next to other enrollments')

        // Dates (step 5): only for enrollments with a known academic year in the calendar
        if (i.registered && i.yearText) {
            const dates = getAcademicYearDates(cfg.calendar, i.yearText, cfg.options)
            if (!dates) {
                note('enrollment', e.enrollment, `academic year "${i.yearText}" not in the school calendar: dates not changed`)
            } else {
                if (day(e.occurredAt) !== dates.startDate) change('occurredAt', dates.startDate, `start of academic year ${i.yearText}`)
                const enrolled = day(e.enrolledAt)
                if (!enrolled || enrolled < dates.startDate || (dates.endDate && enrolled > dates.endDate)) {
                    change('enrolledAt', dates.startDate, `enrollment date outside academic year ${i.yearText}`)
                }
            }
        }

        if (next.status !== e.status || next.enrolledAt !== e.enrolledAt || next.occurredAt !== e.occurredAt) {
            enrollments.push({
                enrollment: e.enrollment, trackedEntity: te.trackedEntity, program: e.program ?? cfg.program, orgUnit: e.orgUnit,
                status: next.status as EnrollmentStatus, enrolledAt: next.enrolledAt, occurredAt: next.occurredAt,
            })
        }
    }
    enrollments.sort((a, b) => Number(a.status === 'ACTIVE') - Number(b.status === 'ACTIVE'))

    // Transfer history (step 6): events with data captured before an approved transfer go back to its origin
    const events: Record<string, unknown>[] = []
    if (restoreTransferHistory && cfg.transferStage && cfg.transferStatusDataElement && cfg.approvedCode) {
        for (const i of info) {
            const transfers = i.events
                .filter(ev => ev.programStage === cfg.transferStage && valueOf(ev, cfg.transferStatusDataElement) === cfg.approvedCode)
                .sort((a, b) => time(a.occurredAt) - time(b.occurredAt))
            if (transfers.length === 0) continue

            for (const ev of i.events) {
                if (ev.programStage === cfg.registrationStage || ev.programStage === cfg.transferStage || !hasData(ev)) continue
                const index = transfers.findIndex(t => time(ev.occurredAt) < time(t.occurredAt))
                if (index === -1) continue
                const origin = transfers[index].orgUnit
                // The school(s) an earlier approval could have moved it to: this transfer's destination or a later one's
                const destinations = transfers.slice(index).map(t => valueOf(t, cfg.transferDestinationDataElement)).filter(Boolean)
                if (!origin || ev.orgUnit === origin || !destinations.includes(ev.orgUnit)) continue

                events.push({ ...ev, enrollment: ev.enrollment ?? i.e.enrollment, trackedEntity: te.trackedEntity, program: i.e.program ?? cfg.program, orgUnit: origin })
                rows.push({
                    trackedEntity: te.trackedEntity, object: 'event', id: String(ev.event), field: 'orgUnit', oldValue: String(ev.orgUnit ?? ''), newValue: origin,
                    reason: `captured before approved transfer ${transfers[index].event} (${day(transfers[index].occurredAt)})`,
                })
            }
        }
    }

    return { enrollments, events, rows }
}
