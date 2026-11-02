/** Pure selection logic for cleanup.ts: which tracked entities carry an ID mangled by the bulk import. */

/** Text Excel's "General" format shows for a long number, e.g. "2.0195E+13". */
export const SCIENTIFIC_NOTATION = /^[-+]?\d+(\.\d+)?E[-+]?\d+$/i

export function isScientificNotation(value: unknown): boolean {
    return typeof value === 'string' && SCIENTIFIC_NOTATION.test(value.trim())
}

export interface Attribute { attribute: string; value?: string; displayName?: string }
export interface TrackedEntity {
    trackedEntity: string
    orgUnit?: string
    createdAt?: string
    deleted?: boolean
    attributes?: Attribute[]
    enrollments?: { enrollment: string; program?: string; status?: string; deleted?: boolean; events?: { event: string }[] }[]
}

export type Reason = 'NO_ENROLLMENT' | 'ID_IN_SCIENTIFIC_NOTATION'

export interface Selected {
    trackedEntity: string
    orgUnit: string
    createdAt: string
    idValue: string
    enrollments: number
    events: number
    reasons: Reason[]
    attributes: string
}

/**
 * Tracked entities left behind by a failed bulk import: those with no enrollment at all (the import
 * created the person but the enrollment was rejected), and those whose `idAttribute` value is in
 * scientific notation. Optionally only those created on or after `createdAfter` (YYYY-MM-DD).
 */
export function selectBroken(teis: TrackedEntity[], idAttribute: string, createdAfter?: string,
    include: { noEnrollment: boolean, scientificId: boolean } = { noEnrollment: true, scientificId: true }): Selected[] {
    const out: Selected[] = []
    for (const t of teis) {
        if (t.deleted) continue
        if (createdAfter && (t.createdAt ?? '').slice(0, 10) < createdAfter) continue
        const id = t.attributes?.find(a => a.attribute === idAttribute)?.value ?? ''
        const enrollments = (t.enrollments ?? []).filter(e => !e.deleted)
        const reasons: Reason[] = []
        if (include.noEnrollment && enrollments.length === 0) reasons.push('NO_ENROLLMENT')
        if (include.scientificId && isScientificNotation(id)) reasons.push('ID_IN_SCIENTIFIC_NOTATION')
        if (!reasons.length) continue
        out.push({
            trackedEntity: t.trackedEntity,
            orgUnit: t.orgUnit ?? '',
            createdAt: t.createdAt ?? '',
            idValue: id,
            enrollments: enrollments.length,
            events: enrollments.reduce((n, e) => n + (e.events?.length ?? 0), 0),
            reasons,
            attributes: (t.attributes ?? []).filter(a => a.attribute !== idAttribute)
                .map(a => `${a.displayName ?? a.attribute}=${a.value ?? ''}`).join('; '),
        })
    }
    return out
}

/** Tracker payload that deletes the selected tracked entities (with importStrategy=DELETE). */
export function deletePayload(selected: Selected[]) {
    return { trackedEntities: selected.map(s => ({ trackedEntity: s.trackedEntity })) }
}
