import { describe, it, expect } from 'vitest'
import {
  fromOffsetDays,
  fromSavedQuery,
  localTodayIso,
  MOVE_TYPE_OPTIONS,
  toOffsetDays,
  toSavedQuery,
  type AvailabilityFilterState,
} from './availability-filter-query'

const TODAY = '2026-10-12'
const ZONES = [
  { value: 'NE', label: 'Northeast' },
  { value: 'SE', label: 'Southeast' },
]

const STATE: AvailabilityFilterState = {
  driverName: '  smith ',
  zones: [ZONES[0]!],
  moveTypes: [MOVE_TYPE_OPTIONS[1]!],
  dateFrom: '2026-07-12',
  dateTo: '',
  sortOrder: 'desc',
}

describe('day offsets', () => {
  it('counts whole calendar days, both directions', () => {
    expect(toOffsetDays('2026-10-12', TODAY)).toBe(0)
    expect(toOffsetDays('2027-01-12', TODAY)).toBe(92)
    expect(toOffsetDays('2026-07-12', TODAY)).toBe(-92)
  })

  it('is not shifted by a DST change inside the range', () => {
    // US DST ends 2026-11-01.
    expect(toOffsetDays('2026-11-02', '2026-10-31')).toBe(2)
    expect(fromOffsetDays(2, '2026-10-31')).toBe('2026-11-02')
  })

  it('treats an empty or junk bound as open', () => {
    expect(toOffsetDays('', TODAY)).toBeNull()
    expect(toOffsetDays('not-a-date', TODAY)).toBeNull()
    expect(fromOffsetDays(null, TODAY)).toBe('')
  })

  it('formats today from local calendar fields', () => {
    expect(localTodayIso(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
  })
})

describe('toSavedQuery', () => {
  it('stores codes, enum values and offsets', () => {
    expect(toSavedQuery(STATE, TODAY)).toEqual({
      v: 1,
      driverName: 'smith',
      zones: ['NE'],
      moveTypes: ['longDistance'],
      dateFromOffsetDays: -92,
      dateToOffsetDays: null,
      sortOrder: 'desc',
    })
  })
})

describe('fromSavedQuery', () => {
  it('round-trips the state on the same day', () => {
    const back = fromSavedQuery(toSavedQuery(STATE, TODAY), ZONES, TODAY)
    expect(back).toEqual({ ...STATE, driverName: 'smith' })
  })

  it('re-anchors relative dates to the day the filter is loaded', () => {
    const saved = toSavedQuery(STATE, TODAY)
    expect(fromSavedQuery(saved, ZONES, '2026-10-22').dateFrom).toBe('2026-07-22')
  })

  it('keeps a zone code missing from the reference list as a code-labelled option', () => {
    const saved = { ...toSavedQuery(STATE, TODAY), zones: ['NE', 'XX'] }
    expect(fromSavedQuery(saved, ZONES, TODAY).zones).toEqual([
      { value: 'NE', label: 'Northeast' },
      { value: 'XX', label: 'XX' },
    ])
  })

  it('matches padded zone codes from the reference list', () => {
    const saved = { ...toSavedQuery(STATE, TODAY), zones: ['NE'] }
    expect(fromSavedQuery(saved, [{ value: 'NE  ', label: 'Northeast' }], TODAY).zones).toEqual([
      { value: 'NE  ', label: 'Northeast' },
    ])
  })
})
