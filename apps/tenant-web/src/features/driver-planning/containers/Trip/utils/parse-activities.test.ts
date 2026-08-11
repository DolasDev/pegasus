import { describe, it, expect } from 'vitest'
import { parseActivities } from './parse-activities'

const stubColor = (i: number) => `c${i}`

describe('parseActivities', () => {
  it('returns empty defaults for an empty activity list', () => {
    const r = parseActivities([], stubColor)
    expect(r).toEqual({
      days: [],
      sortedActivities: [],
      orderIdToColor: {},
      hasDateChange: false,
    })
  })

  it('collects each activity day plus the fill-days between planned_start and planned_end', () => {
    const r = parseActivities(
      [
        {
          order_num: '1001',
          planned_start: '2024-06-01T00:00:00Z',
          planned_end: '2024-06-03T00:00:00Z',
        },
      ],
      stubColor,
    )
    // planned_start + (start+1) + (start+2) = 3 days
    expect(r.days.filter((d) => d !== null)).toHaveLength(3)
    expect(r.hasDateChange).toBe(false)
  })

  it('assigns a stable color to each distinct order_num in first-seen order', () => {
    const r = parseActivities(
      [
        { order_num: 'A', planned_start: '2024-06-01', planned_end: '2024-06-02' },
        { order_num: 'B', planned_start: '2024-06-02', planned_end: '2024-06-03' },
        { order_num: 'A', planned_start: '2024-06-03', planned_end: '2024-06-04' },
      ],
      stubColor,
    )
    expect(r.orderIdToColor).toEqual({ A: 'c0', B: 'c1' })
  })

  it('tracks estimated_date and actual_date as additional days when present', () => {
    const r = parseActivities(
      [
        {
          order_num: '1',
          planned_start: '2024-06-01',
          planned_end: '2024-06-01',
          estimated_date: '2024-07-01',
          actual_date: '2024-08-01',
        },
      ],
      stubColor,
    )
    const isoDays = r.days.filter((d): d is string => d !== null)
    expect(isoDays.some((d) => d.startsWith('2024-07-01'))).toBe(true)
    expect(isoDays.some((d) => d.startsWith('2024-08-01'))).toBe(true)
  })

  it('flags hasDateChange and mutates the activity when shipment dates drift off', () => {
    const activity: any = {
      order_num: '1',
      planned_start: '2024-06-01',
      planned_end: '2024-06-02',
      activityType: { code: 'PACK' },
      shipment: { pack_date2: '2024-07-15', plan_pack: '2024-07-16' },
    }
    const r = parseActivities([activity], stubColor)
    expect(r.hasDateChange).toBe(true)
    expect(activity.hasDateChange).toBe(true)
    expect(activity.newStart).toBe('2024-07-15')
    expect(activity.newEnd).toBe('2024-07-16')
  })

  it('returns activities sorted by effective start date', () => {
    const r = parseActivities(
      [
        { order_num: '1', planned_start: '2024-06-10', planned_end: '2024-06-11' },
        { order_num: '2', planned_start: '2024-06-01', planned_end: '2024-06-02' },
      ],
      stubColor,
    )
    expect(r.sortedActivities.map((a) => a.order_num)).toEqual(['2', '1'])
  })

  it('adds a null entry to days when an activity has a falsy planned_start', () => {
    const r = parseActivities([{ order_num: '1', planned_start: '', planned_end: '' }], stubColor)
    expect(r.days).toContain(null)
  })

  // One calendar day must be one Gantt column. The values feeding `days` come
  // from sources that don't agree on time-of-day (the activity's own dates, the
  // shipment's pegged dates, the day-walk between start and end) while the
  // column header renders only the UTC calendar day — so keying columns by the
  // raw timestamp showed the same date twice.
  describe('one column per calendar day', () => {
    it('collapses same-day activities that differ only in time-of-day', () => {
      const r = parseActivities(
        [
          { order_num: '1', planned_start: '2024-06-05T00:00:00Z' },
          { order_num: '2', planned_start: '2024-06-05T13:30:00Z' },
          { order_num: '3', planned_start: '2024-06-05T23:59:59Z' },
        ],
        stubColor,
      )

      expect(r.days).toEqual(['2024-06-05T00:00:00.000Z'])
    })

    it('adds no extra column when a pegged planned date lands on the activity day', () => {
      // The shipment's plan_pack carries a time-of-day the activity's
      // planned_start does not. Same day → still one column. `mismatched` is
      // driven by planned_END drifting to a different day, which legitimately
      // adds that day.
      const activity: any = {
        order_num: '1',
        planned_start: '2024-06-05T00:00:00Z',
        planned_end: '2024-06-05T00:00:00Z',
        activityType: { code: 'PACK' },
        shipment: { pack_date2: '2024-06-05T08:15:00Z', plan_pack: '2024-06-05T08:15:00Z' },
      }
      const r = parseActivities([activity], stubColor)

      expect(r.days).toEqual(['2024-06-05T00:00:00.000Z'])
    })

    it('normalizes every day key to UTC midnight', () => {
      const r = parseActivities(
        [
          {
            order_num: '1',
            planned_start: '2024-06-05T18:45:00Z',
            planned_end: '2024-06-05T18:45:00Z',
            estimated_date: '2024-06-06T07:20:00Z',
            actual_date: '2024-06-07T22:10:00Z',
          },
        ],
        stubColor,
      )

      expect(r.days).toEqual([
        '2024-06-05T00:00:00.000Z',
        '2024-06-06T00:00:00.000Z',
        '2024-06-07T00:00:00.000Z',
      ])
    })

    it('walks a multi-day activity into one column per day, in order', () => {
      const r = parseActivities(
        [
          {
            order_num: '1',
            planned_start: '2024-06-01T00:00:00Z',
            planned_end: '2024-06-04T00:00:00Z',
          },
        ],
        stubColor,
      )

      expect(r.days).toEqual([
        '2024-06-01T00:00:00.000Z',
        '2024-06-02T00:00:00.000Z',
        '2024-06-03T00:00:00.000Z',
        '2024-06-04T00:00:00.000Z',
      ])
    })

    it('buckets an unparseable date into the Unknown column instead of throwing', () => {
      // `new Date('not-a-date').toISOString()` throws — the old keying crashed
      // the whole Gantt on one malformed row.
      const r = parseActivities(
        [{ order_num: '1', planned_start: 'not-a-date', planned_end: 'not-a-date' }],
        stubColor,
      )

      expect(r.days).toEqual([null])
    })
  })

  describe('day ordering', () => {
    it('returns days ascending regardless of activity order', () => {
      const r = parseActivities(
        [
          { order_num: '1', planned_start: '2024-06-20T00:00:00Z' },
          { order_num: '2', planned_start: '2024-06-02T00:00:00Z' },
          { order_num: '3', planned_start: '2024-06-11T00:00:00Z' },
        ],
        stubColor,
      )

      expect(r.days).toEqual([
        '2024-06-02T00:00:00.000Z',
        '2024-06-11T00:00:00.000Z',
        '2024-06-20T00:00:00.000Z',
      ])
    })

    it('pins the Unknown column last', () => {
      const r = parseActivities(
        [
          { order_num: '1', planned_start: '' },
          { order_num: '2', planned_start: '2024-06-02T00:00:00Z' },
        ],
        stubColor,
      )

      expect(r.days).toEqual(['2024-06-02T00:00:00.000Z', null])
    })
  })

  // Trip 16426 (NWI prod) — the reported duplicate. Its ETAs were stored at
  // 05:00Z by the old `toISOString()` write path, so the pre-#534 Gantt keyed
  // 2026-08-16T00:00:00Z and 2026-08-16T05:00:00Z as two columns both labeled
  // "08/16" (and the same for 08/21). The day-key collapses them; these are the
  // real rows, so the pinning survives a refactor of either half.
  describe('trip 16426 (real prod rows)', () => {
    const peg = (o: Record<string, string>) => ({ total_est_wt: 1, pegasus_shadow: null, ...o })
    const rows = [
      ['490202', 'PACK', '2026-08-17', '2026-08-17', null, null, 'pack_date2', 'plan_pack'],
      ['490202', 'LOAD', '2026-08-18', '2026-08-18', null, null, 'load_date2', 'plan_load'],
      ['490202', 'RDEL', '2026-08-20', '2026-08-25', null, null, 'del_date2', 'plan_del'],
      ['490356', 'PACK', '2026-08-06', '2026-08-06', null, '2026-08-06', 'pack_date2', 'plan_pack'],
      ['490356', 'LOAD', '2026-08-07', '2026-08-07', null, '2026-08-07', 'load_date2', 'plan_load'],
      // The 05:00Z ETA that produced the duplicate "08/16" column.
      [
        '490356',
        'RDEL',
        '2026-08-10',
        '2026-08-20',
        '2026-08-16T05:00:00.000Z',
        null,
        'del_date2',
        'plan_del',
      ],
      ['490701', 'PACK', '2026-08-10', '2026-08-10', null, '2026-08-10', 'pack_date2', 'plan_pack'],
      ['490701', 'LOAD', '2026-08-11', '2026-08-11', null, null, 'load_date2', 'plan_load'],
      // ...and the duplicate "08/21".
      [
        '490701',
        'RDEL',
        '2026-08-13',
        '2026-08-21',
        '2026-08-21T05:00:00.000Z',
        null,
        'del_date2',
        'plan_del',
      ],
    ] as const

    const activities = rows.map(([order, code, start, end, eta, actual, startKey, endKey]) => ({
      order_num: order,
      activityType: { code },
      planned_start: `${start}T00:00:00.000Z`,
      planned_end: `${end}T00:00:00.000Z`,
      estimated_date: eta,
      actual_date: actual ? `${actual}T00:00:00.000Z` : null,
      // The shipment's pegged dates match the activity's — hasDateChange is false.
      shipment: peg({ [startKey]: `${start}T00:00:00.000Z`, [endKey]: `${end}T00:00:00.000Z` }),
    }))

    it('yields 18 distinct columns with no repeated calendar day', () => {
      const r = parseActivities(activities as any, stubColor)

      expect(r.hasDateChange).toBe(false)
      expect(r.days).toHaveLength(18)
      expect(new Set(r.days).size).toBe(18)
      expect(r.days[0]).toBe('2026-08-06T00:00:00.000Z')
      expect(r.days[r.days.length - 1]).toBe('2026-08-25T00:00:00.000Z')
    })

    it('gives the 05:00Z ETAs the same column as their calendar day', () => {
      const r = parseActivities(activities as any, stubColor)

      expect(r.days.filter((d) => d === '2026-08-16T00:00:00.000Z')).toHaveLength(1)
      expect(r.days.filter((d) => d === '2026-08-21T00:00:00.000Z')).toHaveLength(1)
    })
  })
})
