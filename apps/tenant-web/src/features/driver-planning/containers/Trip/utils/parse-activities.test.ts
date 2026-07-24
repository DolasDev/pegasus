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
})
