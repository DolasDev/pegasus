import { describe, it, expect } from 'vitest'
import { getPegDates } from './peg-dates'

const activity = (overrides: object) => ({
  planned_start: '2024-06-01',
  planned_end: '2024-06-02',
  ...overrides,
})

describe('getPegDates', () => {
  it('returns the activity dates and mismatched=false for unknown activity codes', () => {
    const result = getPegDates(
      activity({ activityType: { code: 'WHSE' }, shipment: { plan_load: '2024-06-15' } }),
    )
    expect(result).toEqual({
      mismatched: false,
      plannedStart: '2024-06-01',
      plannedEnd: '2024-06-02',
    })
  })

  it('returns the activity dates and mismatched=false when activityType is missing', () => {
    const result = getPegDates(activity({ shipment: { plan_load: '2024-06-15' } }))
    expect(result).toEqual({
      mismatched: false,
      plannedStart: '2024-06-01',
      plannedEnd: '2024-06-02',
    })
  })

  describe('PACK (PACKING)', () => {
    it('prefers pack_date2 for start and plan_pack for end', () => {
      const a = activity({
        activityType: { code: 'PACK' },
        shipment: { pack_date2: '2024-06-01', plan_pack: '2024-06-02' },
      })
      const result = getPegDates(a)
      expect(result.plannedStart).toBe('2024-06-01')
      expect(result.plannedEnd).toBe('2024-06-02')
      expect(result.mismatched).toBe(false)
    })

    it('falls back to plan_pack for start when pack_date2 is absent', () => {
      const a = activity({
        activityType: { code: 'PACK' },
        shipment: { pack_date2: null, plan_pack: '2024-06-05' },
      })
      const result = getPegDates(a)
      expect(result.plannedStart).toBe('2024-06-05')
      expect(result.plannedEnd).toBe('2024-06-05')
    })

    it('flags mismatched when the shipment dates drift off the activity dates', () => {
      const a = activity({
        planned_start: '2024-06-01',
        planned_end: '2024-06-02',
        activityType: { code: 'PACK' },
        shipment: { pack_date2: '2024-06-10', plan_pack: '2024-06-11' },
      })
      const result = getPegDates(a)
      expect(result.mismatched).toBe(true)
      expect(result.plannedStart).toBe('2024-06-10')
      expect(result.plannedEnd).toBe('2024-06-11')
    })
  })

  describe('LOAD (PICKUP)', () => {
    it('prefers load_date2 for start and plan_load for end', () => {
      const a = activity({
        activityType: { code: 'LOAD' },
        shipment: { load_date2: '2024-06-01', plan_load: '2024-06-02' },
      })
      const result = getPegDates(a)
      expect(result.plannedStart).toBe('2024-06-01')
      expect(result.plannedEnd).toBe('2024-06-02')
      expect(result.mismatched).toBe(false)
    })

    it('flags mismatched when shipment load dates drift off the activity', () => {
      const a = activity({
        planned_start: '2024-06-01',
        planned_end: '2024-06-02',
        activityType: { code: 'LOAD' },
        shipment: { load_date2: '2024-07-01', plan_load: '2024-07-02' },
      })
      expect(getPegDates(a).mismatched).toBe(true)
    })
  })

  describe('RDEL (DELIVERY)', () => {
    it('prefers del_date2 for start and plan_del for end', () => {
      const a = activity({
        activityType: { code: 'RDEL' },
        shipment: { del_date2: '2024-06-20', plan_del: '2024-06-22' },
      })
      const result = getPegDates(a)
      expect(result.plannedStart).toBe('2024-06-20')
      expect(result.plannedEnd).toBe('2024-06-22')
      expect(result.mismatched).toBe(true) // drifts off activity's 06-01/06-02
    })
  })
})
