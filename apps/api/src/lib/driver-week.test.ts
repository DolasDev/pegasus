import { describe, it, expect } from 'vitest'
import { driverWeekFor } from './driver-week'

describe('driverWeekFor', () => {
  it('mid-week (CDT): Wednesday resolves to that Monday 00:00 CDT = 05:00Z', () => {
    const w = driverWeekFor(new Date('2026-10-14T15:00:00Z')) // Wed
    expect(w.weekStartDate).toBe('2026-10-12')
    expect(w.weekStartInstant.toISOString()).toBe('2026-10-12T05:00:00.000Z')
  })

  it('Monday morning Chicago (still Sunday in UTC? no — Monday 00:30 CDT = 05:30Z) is the same day', () => {
    const w = driverWeekFor(new Date('2026-10-12T05:30:00Z'))
    expect(w.weekStartDate).toBe('2026-10-12')
  })

  it('Sunday night Chicago that is already Monday in UTC still belongs to the prior week', () => {
    // Sun 2026-10-11 22:00 CDT = Mon 03:00Z
    const w = driverWeekFor(new Date('2026-10-12T03:00:00Z'))
    expect(w.weekStartDate).toBe('2026-10-05')
    expect(w.weekStartInstant.toISOString()).toBe('2026-10-05T05:00:00.000Z')
  })

  it('one minute before Monday midnight Chicago is still the prior week', () => {
    const w = driverWeekFor(new Date('2026-10-12T04:59:00Z'))
    expect(w.weekStartDate).toBe('2026-10-05')
  })

  it('fall-back week: Monday after DST ends uses CST (06:00Z)', () => {
    // DST ends Sun 2026-11-01. Mon 2026-11-02 00:00 CST = 06:00Z.
    const w = driverWeekFor(new Date('2026-11-02T06:00:00Z'))
    expect(w.weekStartDate).toBe('2026-11-02')
    expect(w.weekStartInstant.toISOString()).toBe('2026-11-02T06:00:00.000Z')
    // Sunday night after the change belongs to the prior week, whose Monday was CDT.
    const sun = driverWeekFor(new Date('2026-11-02T05:30:00Z'))
    expect(sun.weekStartDate).toBe('2026-10-26')
    expect(sun.weekStartInstant.toISOString()).toBe('2026-10-26T05:00:00.000Z')
  })

  it('spring-forward week: Monday after DST starts uses CDT (05:00Z); prior Monday CST', () => {
    // DST starts Sun 2026-03-08. Mon 2026-03-09 00:00 CDT = 05:00Z.
    const w = driverWeekFor(new Date('2026-03-09T05:00:00Z'))
    expect(w.weekStartDate).toBe('2026-03-09')
    expect(w.weekStartInstant.toISOString()).toBe('2026-03-09T05:00:00.000Z')
    // Wednesday of the week that contains the transition keeps a CST Monday (06:00Z).
    const sat = driverWeekFor(new Date('2026-03-07T20:00:00Z'))
    expect(sat.weekStartDate).toBe('2026-03-02')
    expect(sat.weekStartInstant.toISOString()).toBe('2026-03-02T06:00:00.000Z')
    // Mid-transition Sunday (after the jump) still resolves to the CST Monday.
    const sun = driverWeekFor(new Date('2026-03-08T12:00:00Z'))
    expect(sun.weekStartDate).toBe('2026-03-02')
    expect(sun.weekStartInstant.toISOString()).toBe('2026-03-02T06:00:00.000Z')
  })

  it('crosses a year boundary', () => {
    const w = driverWeekFor(new Date('2027-01-01T18:00:00Z')) // Fri
    expect(w.weekStartDate).toBe('2026-12-28')
    expect(w.weekStartInstant.toISOString()).toBe('2026-12-28T06:00:00.000Z')
  })
})
