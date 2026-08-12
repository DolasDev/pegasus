// ---------------------------------------------------------------------------
// Unit tests for date-only normalization of longhaul activity date columns.
// Cases are drawn from the real NWI prod rows that motivated the fix.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'

vi.mock('./logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import {
  toDateOnly,
  normalizeDateOnlyColumns,
  isImplausibleDateOnly,
  findImplausibleDateColumn,
} from './longhaul-date-only'
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

describe('isImplausibleDateOnly', () => {
  const NOW = new Date('2026-08-12T00:00:00Z')

  it.each([
    '1969-12-17',
    '1952-01-01',
    '1960-01-01',
    '1971-01-01',
    '2000-03-08',
    '2001-06-18',
    '2012-01-01',
  ])('flags the sentinel/typo year %s', (bad) => {
    expect(isImplausibleDateOnly(bad, NOW)).toBe(true)
  })

  it.each(['2020-06-09', '2021-11-22', '2026-08-12', '2031-01-01'])(
    'accepts the plausible date %s',
    (ok) => {
      expect(isImplausibleDateOnly(ok, NOW)).toBe(false)
    },
  )

  it('rejects a year too far in the future', () => {
    expect(isImplausibleDateOnly('2032-01-01', NOW)).toBe(true)
  })

  it('treats a missing value as fine — absence is not a bad year', () => {
    expect(isImplausibleDateOnly(null, NOW)).toBe(false)
    expect(isImplausibleDateOnly(undefined, NOW)).toBe(false)
    expect(isImplausibleDateOnly('', NOW)).toBe(false)
  })

  it('normalizes before judging, so a 05:00Z value is read on its own day', () => {
    expect(isImplausibleDateOnly('1969-12-17T05:00:00.000Z', NOW)).toBe(true)
    expect(isImplausibleDateOnly('2026-08-16T05:00:00.000Z', NOW)).toBe(false)
  })

  // The rule this replaced. A plan date may legitimately fall outside the date
  // spread, so plan_del (-> planned_end) can precede del_date2 (-> planned_start);
  // an actual date may likewise precede its planned date. Neither is an error.
  it('does NOT flag a legitimately inverted span', () => {
    expect(isImplausibleDateOnly('2021-03-19', NOW)).toBe(false)
    expect(isImplausibleDateOnly('2021-03-01', NOW)).toBe(false)
  })
})

describe('findImplausibleDateColumn', () => {
  it('names the first offending column', () => {
    expect(
      findImplausibleDateColumn({ planned_start: '2026-01-01', actual_date: '1969-12-17' }),
    ).toBe('actual_date')
  })

  it('returns null when every present column is plausible', () => {
    expect(
      findImplausibleDateColumn({ planned_start: '2021-03-19', planned_end: '2021-03-01' }),
    ).toBeNull()
  })

  it('ignores absent columns', () => {
    expect(findImplausibleDateColumn({ city: 'Reno' })).toBeNull()
  })
})
