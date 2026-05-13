import { describe, it, expect } from 'vitest'
import { sortActivities } from './sort-activities'

describe('sortActivities', () => {
  it('does not mutate the input', () => {
    const input = [
      { planned_start: '2024-06-02', planned_end: '2024-06-03' },
      { planned_start: '2024-06-01', planned_end: '2024-06-02' },
    ]
    const snapshot = [...input]
    sortActivities(input)
    expect(input).toEqual(snapshot)
  })

  it('sorts by planned_start when no actual/estimated overrides', () => {
    const result = sortActivities([
      { planned_start: '2024-06-05', planned_end: '2024-06-06' },
      { planned_start: '2024-06-02', planned_end: '2024-06-03' },
      { planned_start: '2024-06-03', planned_end: '2024-06-04' },
    ])
    expect(result.map((a) => a.planned_start)).toEqual(['2024-06-02', '2024-06-03', '2024-06-05'])
  })

  it('uses actual_date in preference to estimated_date and planned_start', () => {
    const result = sortActivities([
      {
        id: 'a',
        planned_start: '2024-06-10',
        planned_end: '2024-06-11',
        actual_date: '2024-06-01',
      },
      { id: 'b', planned_start: '2024-06-05', planned_end: '2024-06-06' },
    ])
    expect(result.map((a) => a.id)).toEqual(['a', 'b'])
  })

  it('uses estimated_date when actual_date is missing', () => {
    const result = sortActivities([
      {
        id: 'a',
        planned_start: '2024-06-10',
        planned_end: '2024-06-11',
        estimated_date: '2024-06-01',
      },
      { id: 'b', planned_start: '2024-06-05', planned_end: '2024-06-06' },
    ])
    expect(result.map((a) => a.id)).toEqual(['a', 'b'])
  })

  it('sinks activities with no planned_end to the end', () => {
    const result = sortActivities([
      { id: 'a', planned_start: '2024-06-01', planned_end: undefined },
      { id: 'b', planned_start: '2024-06-05', planned_end: '2024-06-06' },
      { id: 'c', planned_start: '2024-06-02', planned_end: '2024-06-03' },
    ])
    // The two with planned_end come first in their date order; 'a' goes last.
    expect(result.map((a) => a.id)).toEqual(['c', 'b', 'a'])
  })

  it('breaks ties by planned_end ascending', () => {
    const result = sortActivities([
      { id: 'late', planned_start: '2024-06-01', planned_end: '2024-06-05' },
      { id: 'early', planned_start: '2024-06-01', planned_end: '2024-06-02' },
    ])
    expect(result.map((a) => a.id)).toEqual(['early', 'late'])
  })
})
