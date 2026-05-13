import { describe, it, expect } from 'vitest'
import { datediff, addDays, sameDayCheck } from './date'

describe('datediff', () => {
  it('returns whole-day difference (second - first)', () => {
    expect(datediff('2024-01-01', '2024-01-04')).toBe(3)
  })

  it('returns negative when second precedes first', () => {
    expect(datediff('2024-01-10', '2024-01-08')).toBe(-2)
  })

  it('rounds across DST-style partial days', () => {
    expect(datediff('2024-03-10T00:00:00Z', '2024-03-11T05:30:00Z')).toBe(1)
  })

  it('accepts Date instances', () => {
    expect(datediff(new Date('2024-06-01'), new Date('2024-06-05'))).toBe(4)
  })
})

describe('addDays', () => {
  it('returns a new Date `days` days later', () => {
    const result = addDays('2024-01-30', 3)
    expect(result.getFullYear()).toBe(2024)
    expect(result.getMonth()).toBe(1) // February
    expect(result.getDate()).toBe(2)
  })

  it('handles negative offsets', () => {
    const result = addDays('2024-03-01', -1)
    expect(result.getMonth()).toBe(1)
    expect(result.getDate()).toBe(29) // 2024 is a leap year
  })

  it('does not mutate the input Date', () => {
    const input = new Date('2024-05-10')
    const before = input.getTime()
    addDays(input, 5)
    expect(input.getTime()).toBe(before)
  })
})

describe('sameDayCheck', () => {
  it('returns true for two ISO strings on the same calendar day', () => {
    expect(sameDayCheck('2024-06-15T01:00:00', '2024-06-15T23:59:00')).toBe(true)
  })

  it('returns false for adjacent days', () => {
    expect(sameDayCheck('2024-06-15', '2024-06-16')).toBe(false)
  })

  it('returns false when one side is undefined / empty / invalid (NaN timestamp)', () => {
    // `new Date(undefined)` and `new Date('')` produce Invalid Date → NaN
    // timestamp → guarded to false. Note `new Date(null)` coerces to epoch
    // 1970-01-01 — that case is handled in the next test.
    expect(sameDayCheck('2024-06-15', undefined)).toBe(false)
    expect(sameDayCheck('', '2024-06-15')).toBe(false)
    expect(sameDayCheck(null, '2024-06-15')).toBe(false)
  })

  it('treats null as the Unix epoch (matches `new Date(null)` semantics)', () => {
    // Documents the preserved legacy behavior — both sides null → both epoch
    // → same calendar day. Callers that want to reject null should guard
    // before calling.
    expect(sameDayCheck(null, null)).toBe(true)
  })

  it('returns false when either side is an invalid date string', () => {
    expect(sameDayCheck('not-a-date', '2024-06-15')).toBe(false)
  })

  it('compares Date instances and strings interchangeably', () => {
    expect(sameDayCheck(new Date('2024-06-15T10:00:00'), '2024-06-15')).toBe(true)
  })
})
