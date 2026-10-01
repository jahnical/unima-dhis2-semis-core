import { planTrackedEntity, type MigrationConfig } from './plan'

const cfg: MigrationConfig = {
    program: 'P1', registrationStage: 'REG', academicYearDataElement: 'AY',
    finalResultStage: 'FINAL', finalResultStatusDataElement: 'FS', dropoutStatusValues: ['Dropout'],
    transferStage: 'TRANSFER', transferStatusDataElement: 'ST', transferDestinationDataElement: 'DEST', approvedCode: 'Approved',
    currentAcademicYear: '2025/2026',
    calendar: [
        { academicYear: { code: '2024/2025', label: '2024/2025', startDate: '2024-09-02', endDate: '2025-07-18' } },
        { academicYear: { code: '2025/2026', label: '2025/2026', startDate: '2025-09-08', endDate: '2026-07-17' } },
    ],
    options: [],
}
const reg = (year: string, extra: any = {}) => ({ event: `R${year}`, programStage: 'REG', orgUnit: 'S1', dataValues: [{ dataElement: 'AY', value: year }], ...extra })
const fr = (value: string) => ({ event: `F${value}`, programStage: 'FINAL', orgUnit: 'S1', dataValues: [{ dataElement: 'FS', value }] })
const enr = (id: string, status: string, events: any[], extra: any = {}) =>
    ({ enrollment: id, status, orgUnit: 'S1', program: 'P1', enrolledAt: '2025-09-08', occurredAt: '2025-09-08', events, ...extra })
const statuses = (plan: ReturnType<typeof planTrackedEntity>) => Object.fromEntries(plan.enrollments.map(e => [e.enrollment, e.status]))

test('final results decide status; latest year without one becomes ACTIVE, earlier ones COMPLETED', () => {
    const plan = planTrackedEntity({
        trackedEntity: 'T1', enrollments: [
            enr('E1', 'COMPLETED', [reg('2023/2024')], { enrolledAt: '2023-09-04', occurredAt: '2023-09-04' }),
            enr('E2', 'COMPLETED', [reg('2024/2025'), fr('Dropout')], { enrolledAt: '2024-09-02', occurredAt: '2024-09-02' }),
            enr('E3', 'COMPLETED', [reg('2025/2026')]),
        ],
    }, cfg)
    expect(statuses(plan)).toEqual({ E2: 'CANCELLED', E3: 'ACTIVE' })
    expect(plan.enrollments.map(e => e.enrollment)).toEqual(['E2', 'E3'])
    // 2023/2024 is not in the calendar: reported, not changed
    expect(plan.rows.some(r => r.id === 'E1' && r.reason.includes('not in the school calendar'))).toBe(true)
})

test('dates: occurredAt becomes the year start, enrolledAt only when outside the year', () => {
    const plan = planTrackedEntity({
        trackedEntity: 'T1', enrollments: [
            enr('E1', 'COMPLETED', [reg('2024/2025'), fr('Promoted')], { enrolledAt: '2025-08-01', occurredAt: '2025-08-01' }),
            enr('E2', 'ACTIVE', [reg('2025/2026')], { enrolledAt: '2025-10-02', occurredAt: '2026-07-20' }),
        ],
    }, cfg)
    expect(plan.enrollments).toEqual([
        { enrollment: 'E1', trackedEntity: 'T1', program: 'P1', orgUnit: 'S1', status: 'COMPLETED', enrolledAt: '2024-09-02', occurredAt: '2024-09-02' },
        { enrollment: 'E2', trackedEntity: 'T1', program: 'P1', orgUnit: 'S1', status: 'ACTIVE', enrolledAt: '2025-10-02', occurredAt: '2025-09-08' },
    ])
})

test('admission-only enrollments and duplicates never leave two ACTIVE', () => {
    expect(statuses(planTrackedEntity({ trackedEntity: 'T1', enrollments: [enr('E0', 'COMPLETED', [])] }, cfg))).toEqual({ E0: 'ACTIVE' })

    const plan = planTrackedEntity({
        trackedEntity: 'T1', enrollments: [
            enr('E0', 'ACTIVE', []),
            enr('E1', 'ACTIVE', [reg('2025/2026')]),
            enr('E2', 'COMPLETED', [reg('2025/2026')], { enrolledAt: '2025-09-20' }),
        ],
    }, cfg)
    expect(statuses(plan)).toEqual({ E0: 'COMPLETED' })
    expect(plan.rows.filter(r => r.id === 'E0' && r.field === '')).toHaveLength(1)
})

test('restores events captured before an approved transfer', () => {
    const plan = planTrackedEntity({
        trackedEntity: 'T1', enrollments: [enr('E1', 'ACTIVE', [
            reg('2025/2026', { orgUnit: 'S2' }),
            { event: 'A1', programStage: 'ATT', orgUnit: 'S2', occurredAt: '2025-10-01', dataValues: [{ dataElement: 'x', value: 'present' }] },
            { event: 'A2', programStage: 'ATT', orgUnit: 'S2', occurredAt: '2026-02-01', dataValues: [{ dataElement: 'x', value: 'present' }] },
            { event: 'M1', programStage: 'TERM1', orgUnit: 'S2', occurredAt: '2025-09-10', dataValues: [] },
            { event: 'TR', programStage: 'TRANSFER', orgUnit: 'S1', occurredAt: '2026-01-15', dataValues: [{ dataElement: 'ST', value: 'Approved' }, { dataElement: 'DEST', value: 'S2' }] },
        ])],
    }, cfg, { restoreTransferHistory: true })
    expect(plan.events.map(e => [e.event, e.orgUnit])).toEqual([['A1', 'S1']])
    expect(planTrackedEntity({ trackedEntity: 'T1', enrollments: [] }, cfg, { restoreTransferHistory: true }).events).toEqual([])
})
