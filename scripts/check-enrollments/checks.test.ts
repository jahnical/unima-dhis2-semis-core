import { checkLearner, fixPayloads, type CheckConfig, type Learner } from './checks'

const REG = 'Ni2qsy2WJn4', YEAR = 'yearDE', T1 = 'mBEhR2M4DRQ', T2 = 'aDmsN3qemOA', FR = 'hcrjYJ6Yl5F', ATT = 'Ljyrr3cktAr', STATUS = 'frStatus'
const cfg: CheckConfig = {
    registrationStage: REG, academicYearDataElement: YEAR, attendanceStage: ATT, performanceStages: [T1, T2],
    finalResultStage: FR, finalResultStatusDataElement: STATUS, dropoutStatusValues: ['Dropout'], options: [], today: '2026-10-04',
    calendar: [{
        academicYear: { code: '2021', label: '2020-2021', startDate: '2020-09-14', endDate: '2021-07-23' },
        classPeriods: [{ startDate: '2020-09-14', endDate: '2020-12-18' }, { startDate: '2021-01-11', endDate: '2021-03-26' }],
    } as any],
}
const ev = (event: string, programStage: string, occurredAt: string, dataValues: any[] = []) => ({ event, programStage, occurredAt, orgUnit: 'ou1', dataValues })
const year2021 = (status = 'COMPLETED', events: any[] = []) => ({
    enrollment: 'E21', status, orgUnit: 'ou1', program: 'P', enrolledAt: '2020-09-14', occurredAt: '2020-09-14',
    events: [ev('r', REG, '2026-10-04', [{ dataElement: YEAR, value: '2021' }]), ...events],
})
const empty = { enrollment: 'E0', status: 'ACTIVE', orgUnit: 'ou1', enrolledAt: '2026-10-01', events: [] }
const run = (l: Learner, fixes = { deleteEmpty: true, fixEventDates: true, fixStatus: true }) => checkLearner(l, cfg, fixes)

test('empty enrollment next to a proper one can be deleted', () => {
    const f = run({ trackedEntity: 'T', enrollments: [empty, year2021()] }).filter(x => x.type === 'EMPTY_ENROLLMENT')
    expect(f).toHaveLength(1)
    expect(f[0].fix).toEqual({ kind: 'DELETE_ENROLLMENT' })
})

test('the only enrollment is never deleted, even when empty', () => {
    const f = run({ trackedEntity: 'T', enrollments: [empty] })
    expect(f.find(x => x.type === 'EMPTY_ENROLLMENT')?.fix).toBeUndefined()
})

test('no fixes unless asked', () => {
    const f = run({ trackedEntity: 'T', enrollments: [empty, year2021()] }, { deleteEmpty: false, fixEventDates: false, fixStatus: false })
    expect(f.every(x => !x.fix)).toBe(true)
})

test('events outside the year get the term end, year end or enrollment date; attendance is left alone', () => {
    const l = { trackedEntity: 'T', enrollments: [year2021('COMPLETED', [ev('t2', T2, '2026-10-04'), ev('fr', FR, '2026-10-04', [{ dataElement: STATUS, value: 'Promoted' }]), ev('a', ATT, '2026-10-04'), ev('ok', T1, '2020-12-18')])] }
    const dates = Object.fromEntries(run(l).filter(x => x.type === 'EVENT_DATE_OUTSIDE_YEAR').map(x => [x.event, (x.fix as any).newDate]))
    expect(dates).toEqual({ r: '2020-09-14', t2: '2021-03-26', fr: '2021-07-23' })
    const { events } = fixPayloads(run(l))
    expect(events.find(e => e.event === 't2')).toMatchObject({ occurredAt: '2021-03-26', scheduledAt: '2021-03-26', enrollment: 'E21', trackedEntity: 'T', programStage: T2 })
})

test('dropout on an ACTIVE enrollment is set to CANCELLED, sending back its dates', () => {
    const l = { trackedEntity: 'T', enrollments: [year2021('ACTIVE', [ev('fr', FR, '2021-07-23', [{ dataElement: STATUS, value: 'Dropout' }])])] }
    const f = run(l).filter(x => x.type === 'STATUS_NOT_MATCHING_RESULT')
    expect(f).toHaveLength(1)
    expect(fixPayloads(f).enrollments).toEqual([{ enrollment: 'E21', trackedEntity: 'T', program: 'P', orgUnit: 'ou1', enrolledAt: '2020-09-14', occurredAt: '2020-09-14', status: 'CANCELLED' }])
})

test('two enrollments for one year and two ACTIVE are reported', () => {
    const a = year2021('ACTIVE'), b = { ...year2021('ACTIVE'), enrollment: 'E21b' }
    const types = run({ trackedEntity: 'T', enrollments: [a, b] }).map(x => x.type)
    expect(types.filter(t => t === 'DUPLICATE_YEAR')).toHaveLength(2)
    expect(types.filter(t => t === 'MULTIPLE_ACTIVE')).toHaveLength(2)
})

test('term and final-result events inside the year but on the enrollment date are re-dated to term end / year end', () => {
    const l = { trackedEntity: 'T', enrollments: [year2021('COMPLETED', [ev('t1', T1, '2020-09-14', [{ dataElement: 'score', value: '60' }]), ev('fr', FR, '2020-09-14'), ev('ok', T2, '2021-03-26'), ev('a', ATT, '2020-09-15')])] }
    const f = run(l).filter(x => x.type === 'STAGE_EVENT_DATE')
    expect(Object.fromEntries(f.map(x => [x.event, (x.fix as any).newDate]))).toEqual({ t1: '2020-12-18', fr: '2021-07-23' })
})
