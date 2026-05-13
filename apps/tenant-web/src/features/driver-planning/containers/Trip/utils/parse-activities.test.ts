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
})
