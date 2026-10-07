/**
 * Enrollment checks for one learner (tracked entity), used by check.ts. Pure: no API calls.
 *
 * Findings
 *  - EMPTY_ENROLLMENT       enrollment without a registration event (no year, standard or class). Left by
 *                           the admission step when the learner was later enrolled in a past year.
 *  - DUPLICATE_YEAR         two enrollments for the same academic year
 *  - MULTIPLE_ACTIVE        more than one ACTIVE enrollment
 *  - EVENT_DATE_OUTSIDE_YEAR an event dated outside its enrollment's academic year (promotion used to date
 *                           every new-year event on the day of the promotion)
 *  - STAGE_EVENT_DATE       a performance term or final-result event inside its year but not on the expected
 *                           date (term end / year end). These events used to keep the enrollment date, so
 *                           analytics put every term and the year-end result at the start of the year.
 *  - STATUS_NOT_MATCHING_RESULT  a dropout final result on an enrollment that is not CANCELLED, or another
 *                           final result on one that is still ACTIVE (a final result import used to skip
 *                           the status when some rows of the file had no decision)
 *
 * Fixes (only when asked for)
 *  - DELETE_ENROLLMENT  an empty enrollment with no events at all, next to an enrollment that has a
 *                       registration event (so the learner keeps a proper enrollment)
 *  - UPDATE_STATUS      the status the final result gives: CANCELLED for a dropout, otherwise COMPLETED
 *  - UPDATE_EVENT_DATE  registration and other stages: the enrollment date; performance term N: the last
 *                       day of term N; final result: the last day of the year; never after today
 */
import {
    academicYearOf, academicYearOrder, getAcademicYearDates, statusForFinalResult,
    type CalendarEntry, type ExistingEnrollment, type ExistingEvent,
} from '../../src/libs/functions/src/utils/enrollment/enrollmentLifecycle'
import type { YearOption } from '../../src/libs/functions/src/utils/validateEnrollmentYear'

export interface CheckConfig {
    registrationStage: string
    academicYearDataElement: string
    attendanceStage?: string
    transferStage?: string
    performanceStages: string[]
    finalResultStage?: string
    finalResultStatusDataElement?: string
    dropoutStatusValues: string[]
    calendar: CalendarEntry[]
    options: YearOption[]
    today: string
}

export interface Learner {
    trackedEntity: string
    enrollments?: (ExistingEnrollment & { events?: (ExistingEvent & { scheduledAt?: string })[] })[]
}

export type FindingType = 'EMPTY_ENROLLMENT' | 'DUPLICATE_YEAR' | 'MULTIPLE_ACTIVE' | 'EVENT_DATE_OUTSIDE_YEAR' | 'STAGE_EVENT_DATE' | 'STATUS_NOT_MATCHING_RESULT'

export interface Finding {
    type: FindingType
    trackedEntity: string
    enrollment: string
    event?: string
    detail: string
    /** What the fix would do, when there is a safe one */
    fix?: { kind: 'DELETE_ENROLLMENT' } | { kind: 'UPDATE_STATUS', status: string, enrollment: ExistingEnrollment } | { kind: 'UPDATE_EVENT_DATE', newDate: string, event: ExistingEvent & { scheduledAt?: string }, orgUnit: string }
}

const day = (s?: string) => (s ? s.slice(0, 10) : undefined)
const live = <T extends { deleted?: boolean }>(xs?: T[]) => (xs ?? []).filter(x => !x.deleted)

/** Calendar entry of a year (for its terms), matched on the dates getAcademicYearDates returns. */
function entryFor(cfg: CheckConfig, code: string) {
    const dates = getAcademicYearDates(cfg.calendar, code, cfg.options)
    if (!dates) return undefined
    const entry = cfg.calendar.find(c => day(c?.academicYear?.startDate) === dates.startDate) as any
    const terms = [...(entry?.classPeriods ?? [])].sort((a: any, b: any) => String(a?.startDate).localeCompare(String(b?.startDate)))
    return { ...dates, terms: terms as { startDate?: string, endDate?: string }[] }
}

/** Date an event of this stage should have in the enrollment's year (see the header). */
export function expectedEventDate(cfg: CheckConfig, stage: string, enrolledAt: string | undefined,
    year: { startDate: string, endDate?: string, terms: { endDate?: string }[] }): string {
    const cap = (d: string) => (d < cfg.today ? d : cfg.today)
    const yearEnd = year.endDate ?? cfg.today
    const term = cfg.performanceStages.indexOf(stage)
    if (term >= 0 && day(year.terms[term]?.endDate)) return cap(day(year.terms[term].endDate)!)
    if (stage === cfg.finalResultStage) return cap(yearEnd)
    const enrolled = day(enrolledAt)
    const inside = enrolled && enrolled >= year.startDate && enrolled <= yearEnd ? enrolled : year.startDate
    return cap(inside)
}

export function checkLearner(learner: Learner, cfg: CheckConfig, fixes: { deleteEmpty: boolean, fixEventDates: boolean, fixStatus?: boolean }): Finding[] {
    const out: Finding[] = []
    const enrollments = live(learner.enrollments)
    const te = learner.trackedEntity
    const hasRegistration = (e: Learner['enrollments'] extends (infer U)[] | undefined ? U : never) =>
        live(e.events).some(ev => ev.programStage === cfg.registrationStage)

    // Empty enrollments
    const proper = enrollments.filter(hasRegistration)
    for (const e of enrollments.filter(e => !hasRegistration(e))) {
        const events = live(e.events).length
        const safe = events === 0 && proper.length > 0
        out.push({
            type: 'EMPTY_ENROLLMENT', trackedEntity: te, enrollment: e.enrollment,
            detail: `${e.status}, enrolled ${day(e.enrolledAt) ?? '?'}, ${events} event(s), ${proper.length} other enrollment(s) with a registration event`,
            ...(safe && fixes.deleteEmpty ? { fix: { kind: 'DELETE_ENROLLMENT' as const } } : {}),
        })
    }

    // Same year twice
    const byYear = new Map<string, string[]>()
    for (const e of proper) {
        const code = academicYearOf(e, cfg.registrationStage, cfg.academicYearDataElement)
        if (code == null || code === '') continue
        const key = String(academicYearOrder(code, { calendars: cfg.calendar, options: cfg.options }) ?? code)
        byYear.set(key, [...(byYear.get(key) ?? []), e.enrollment])
    }
    for (const [year, ids] of byYear) {
        if (ids.length > 1) for (const id of ids) out.push({ type: 'DUPLICATE_YEAR', trackedEntity: te, enrollment: id, detail: `year ${year}: ${ids.join(', ')}` })
    }

    // More than one ACTIVE
    const active = enrollments.filter(e => e.status === 'ACTIVE')
    if (active.length > 1) {
        for (const e of active) out.push({ type: 'MULTIPLE_ACTIVE', trackedEntity: te, enrollment: e.enrollment, detail: `${active.length} ACTIVE: ${active.map(x => x.enrollment).join(', ')}` })
    }

    // Status that does not follow the final result
    if (cfg.finalResultStage && cfg.finalResultStatusDataElement) {
        for (const e of enrollments) {
            const decision = live(e.events).find(ev => ev.programStage === cfg.finalResultStage)
                ?.dataValues?.find(dv => dv.dataElement === cfg.finalResultStatusDataElement)?.value
            if (decision == null || String(decision).trim() === '') continue
            const expected = statusForFinalResult(String(decision), cfg.dropoutStatusValues)
            const wrong = expected === 'CANCELLED' ? e.status !== 'CANCELLED' : e.status === 'ACTIVE'
            if (!wrong) continue
            out.push({
                type: 'STATUS_NOT_MATCHING_RESULT', trackedEntity: te, enrollment: e.enrollment,
                detail: `final result ${decision}, enrollment ${e.status}, should be ${expected}`,
                ...(fixes.fixStatus ? { fix: { kind: 'UPDATE_STATUS' as const, status: expected, enrollment: e } } : {}),
            })
        }
    }

    // Events outside their enrollment's year (attendance and transfer events keep their own dates)
    for (const e of proper) {
        const code = academicYearOf(e, cfg.registrationStage, cfg.academicYearDataElement)
        const year = code ? entryFor(cfg, String(code)) : undefined
        if (!year) continue
        const yearEnd = year.endDate ?? cfg.today
        for (const ev of live(e.events)) {
            if (ev.programStage === cfg.attendanceStage || ev.programStage === cfg.transferStage) continue
            const date = day(ev.occurredAt)
            const newDate = expectedEventDate(cfg, ev.programStage, e.enrolledAt, year)
            if (date && date >= year.startDate && date <= yearEnd) {
                // Inside the year: term and final-result events must still sit on their own date
                const datedStage = cfg.performanceStages.includes(ev.programStage) || ev.programStage === cfg.finalResultStage
                if (datedStage && date !== newDate) out.push({
                    type: 'STAGE_EVENT_DATE', trackedEntity: te, enrollment: e.enrollment, event: ev.event,
                    detail: `stage ${ev.programStage} dated ${date}, should be ${newDate}`,
                    ...(fixes.fixEventDates && ev.event ? { fix: { kind: 'UPDATE_EVENT_DATE' as const, newDate, event: ev, orgUnit: e.orgUnit } } : {}),
                })
                continue
            }
            out.push({
                type: 'EVENT_DATE_OUTSIDE_YEAR', trackedEntity: te, enrollment: e.enrollment, event: ev.event,
                detail: `stage ${ev.programStage} dated ${date ?? '(none)'}, year ${code} is ${year.startDate} to ${yearEnd}, should be ${newDate}`,
                ...(fixes.fixEventDates && ev.event ? { fix: { kind: 'UPDATE_EVENT_DATE' as const, newDate, event: ev, orgUnit: e.orgUnit } } : {}),
            })
        }
    }
    return out
}

/** Tracker payloads for the fixes: enrollments to delete, events to update (all their fields sent back). */
export function fixPayloads(findings: Finding[]) {
    const deleteEnrollments = findings.filter(f => f.fix?.kind === 'DELETE_ENROLLMENT').map(f => ({ enrollment: f.enrollment }))
    const events = findings.flatMap(f => f.fix?.kind === 'UPDATE_EVENT_DATE' ? [{
        ...f.fix.event,
        enrollment: f.enrollment,
        trackedEntity: f.trackedEntity,
        orgUnit: f.fix.event.orgUnit ?? f.fix.orgUnit,
        occurredAt: f.fix.newDate,
        scheduledAt: f.fix.newDate,
    }] : [])
    // Status changes send back the saved org unit and dates so nothing else changes
    const enrollments = findings.flatMap(f => f.fix?.kind === 'UPDATE_STATUS' ? [{
        enrollment: f.enrollment,
        trackedEntity: f.trackedEntity,
        program: f.fix.enrollment.program,
        orgUnit: f.fix.enrollment.orgUnit,
        enrolledAt: f.fix.enrollment.enrolledAt,
        occurredAt: f.fix.enrollment.occurredAt,
        status: f.fix.status,
    }] : [])
    return { deleteEnrollments, events, enrollments }
}
