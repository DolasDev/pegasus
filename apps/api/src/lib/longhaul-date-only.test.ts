// ---------------------------------------------------------------------------
// Unit tests for date-only normalization of longhaul activity date columns.
// Cases are drawn from the real NWI prod rows that motivated the fix.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'

vi.mock('./logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { toDateOnly, normalizeDateOnlyColumns, isInvertedSpan } from './longhaul-date-only'
import { logger } from './logger'

describe('toDateOnly', () => {
  it('takes YYYY-MM-DD verbatim, with no timezone math', () => {
    expect(toDateOnly('2026-08-16')).toEqual({ value: '2026-08-16 00:00:00', coerced: false })
  })

  it('drops the 05:00Z the pickers used to write (trip 16426, activity 101752)', () => {
    // This value plus the day-walk's 2026-08-16T00:00:00Z is what rendered
    // "08/16" twice in the legacy Gantt.
    expect(toDateOnly('2026-08-16T05:00:00.000Z')).toEqual({
      value: '2026-08-16 00:00:00',
      coerced: true,
    })
  })

  it('keeps a value that is already naive midnight, uncoerced', () => {
    expect(toDateOnly('2026-08-20T00:00:00.000Z')).toEqual({
      value: '2026-08-20 00:00:00',
      coerced: false,
    })
  })

  it('truncates an explicit offset to its UTC day', () => {
    // 2026-08-16T00:00:00-05:00 is 05:00Z the same day.
    expect(toDateOnly('2026-08-16T00:00:00-05:00')).toEqual({
      value: '2026-08-16 00:00:00',
      coerced: true,
    })
  })

  it('keeps the wall-clock day of an offsetless datetime', () => {
    expect(toDateOnly('2026-08-16 13:45:00')).toEqual({
      value: '2026-08-16 00:00:00',
      coerced: true,
    })
  })

  it('normalizes a Date instance by its UTC day', () => {
    expect(toDateOnly(new Date('2026-08-16T05:00:00.000Z'))).toEqual({
      value: '2026-08-16 00:00:00',
      coerced: true,
    })
  })

  it.each([null, undefined, '', 'not-a-date', 42, {}])('maps %p to null', (input) => {
    expect(toDateOnly(input).value).toBeNull()
  })

  it('preserves the year — a wrong-year value is normalized, never repaired', () => {
    // Repairing years is a data-cleanup decision, not a write-path one.
    expect(toDateOnly('1969-12-17T05:00:00.000Z').value).toBe('1969-12-17 00:00:00')
  })
})

describe('normalizeDateOnlyColumns', () => {
  it('normalizes only the date-only columns that are present', () => {
    const out = normalizeDateOnlyColumns({
      estimated_date: '2026-08-16T05:00:00.000Z',
      planned_start: '2026-08-20T00:00:00.000Z',
      status: 'In-Progress',
    })
    expect(out).toEqual({
      estimated_date: '2026-08-16 00:00:00',
      planned_start: '2026-08-20 00:00:00',
      status: 'In-Progress',
    })
  })

  it('leaves omitted columns absent rather than nulling them', () => {
    const out = normalizeDateOnlyColumns({ status: 'x' })
    expect('estimated_date' in out).toBe(false)
    expect('actual_date' in out).toBe(false)
  })

  it('keeps an explicit null null', () => {
    expect(normalizeDateOnlyColumns({ actual_date: null }).actual_date).toBeNull()
  })

  it('warns once per coerced column so a bad client stays visible', () => {
    vi.mocked(logger.warn).mockClear()
    normalizeDateOnlyColumns(
      { estimated_date: '2026-08-16T05:00:00.000Z', actual_date: '2026-08-10T00:00:00.000Z' },
      { activityId: 101752 },
    )
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logger.warn).mock.calls[0]![1]).toMatchObject({
      column: 'estimated_date',
      activityId: 101752,
    })
  })

  it('does not mutate its input', () => {
    const input = { estimated_date: '2026-08-16T05:00:00.000Z' }
    normalizeDateOnlyColumns(input)
    expect(input.estimated_date).toBe('2026-08-16T05:00:00.000Z')
  })
})

describe('isInvertedSpan', () => {
  it('flags the real wrong-year prod rows', () => {
    // id 9911, id 55057, id 91212 — same MM/DD, previous year.
    expect(isInvertedSpan('2021-08-19T00:00:00.000Z', '2020-08-19T00:00:00.000Z')).toBe(true)
    expect(isInvertedSpan('2024-01-24T00:00:00.000Z', '2023-01-24T00:00:00.000Z')).toBe(true)
    expect(isInvertedSpan('2026-01-05T00:00:00.000Z', '2025-01-06T00:00:00.000Z')).toBe(true)
  })

  it('accepts a normal forward span and a same-day span', () => {
    expect(isInvertedSpan('2026-08-20T00:00:00.000Z', '2026-08-25T00:00:00.000Z')).toBe(false)
    expect(isInvertedSpan('2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z')).toBe(false)
  })

  it('does not flag a same-day pair that differs only in time-of-day', () => {
    expect(isInvertedSpan('2026-08-16T05:00:00.000Z', '2026-08-16T00:00:00.000Z')).toBe(false)
  })

  it('never flags when either bound is missing', () => {
    expect(isInvertedSpan(null, '2026-08-25')).toBe(false)
    expect(isInvertedSpan('2026-08-25', undefined)).toBe(false)
  })
})
