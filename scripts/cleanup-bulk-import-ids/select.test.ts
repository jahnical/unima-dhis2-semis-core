import { deletePayload, isScientificNotation, selectBroken, type TrackedEntity } from './select'

const LIN = 'IemwobHLkQv'
const tei = (id: string, lin: string | undefined, createdAt = '2026-10-02T08:00:00.000', extra: Partial<TrackedEntity> = {}): TrackedEntity => ({
    trackedEntity: id, orgUnit: 'ou1', createdAt,
    attributes: [{ attribute: 'gz8w04YBSS0', displayName: 'First name', value: 'Zione' }, ...(lin === undefined ? [] : [{ attribute: LIN, value: lin }])],
    ...extra,
})

describe('cleanup selection', () => {
    it('recognises scientific notation only', () => {
        expect(isScientificNotation('2.0195E+13')).toBe(true)
        expect(isScientificNotation('2E13')).toBe(true)
        expect(isScientificNotation('20195001930001')).toBe(false)
        expect(isScientificNotation('LIN-2E+13')).toBe(false)
        expect(isScientificNotation(undefined)).toBe(false)
    })

    it('selects tracked entities with no enrollment or a mangled ID and leaves the rest', () => {
        const enrolled = { enrollments: [{ enrollment: 'en1', events: [{ event: 'ev1' }, { event: 'ev2' }] }] }
        const teis = [
            tei('a', '2.0195E+13'),                                  // no enrollment and mangled ID
            tei('b', '20195001930002', undefined, enrolled),         // fine
            tei('c', undefined),                                     // no enrollment, no ID (attributes rejected with the enrollment)
            tei('d', '2.0195E+13', undefined, { deleted: true }),    // already deleted
            tei('e', '2.0195E+13', undefined, enrolled),             // enrolled but mangled ID
            tei('f', '20195001930006', undefined, { enrollments: [{ enrollment: 'en2', deleted: true }] }), // only a deleted enrollment
        ]
        const selected = selectBroken(teis, LIN)
        expect(selected.map(s => [s.trackedEntity, s.reasons])).toEqual([
            ['a', ['NO_ENROLLMENT', 'ID_IN_SCIENTIFIC_NOTATION']], ['c', ['NO_ENROLLMENT']],
            ['e', ['ID_IN_SCIENTIFIC_NOTATION']], ['f', ['NO_ENROLLMENT']]])
        expect(selected[2]).toMatchObject({ enrollments: 1, events: 2, idValue: '2.0195E+13', attributes: 'First name=Zione' })
        expect(deletePayload(selected).trackedEntities).toHaveLength(4)
        expect(selectBroken(teis, LIN, undefined, { noEnrollment: true, scientificId: false }).map(s => s.trackedEntity)).toEqual(['a', 'c', 'f'])
    })

    it('limits the selection to records created on or after a date', () => {
        const teis = [tei('old', '2.0195E+13', '2026-09-30T10:00:00.000'), tei('new', '2.0195E+13', '2026-10-01T10:00:00.000')]
        expect(selectBroken(teis, LIN, '2026-10-01').map(s => s.trackedEntity)).toEqual(['new'])
    })
})
