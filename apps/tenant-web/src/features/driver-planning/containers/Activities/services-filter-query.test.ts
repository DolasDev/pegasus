import { describe, expect, it } from 'vitest'
import { fromSavedQuery, toOptions, toSavedQuery } from './services-filter-query'
import type { ActivityQuery } from '../../redux/activities'

const TODAY = '2026-10-21'

const REFS = {
  activityTypes: [
    { label: 'PK', value: 'PK' },
    { label: 'LD', value: 'LD' },
  ],
  dispatchers: [{ label: 'Ann Bee', value: '1196' }],
}

const BOARD: ActivityQuery = {
  filters: {
    date_range: ['2026-10-20', '2026-11-04'],
    activity_type: [{ label: 'PK', value: 'PK' }],
    short_haul: [{ label: 'Yes', value: 'Y' }],
    operations_id: [{ label: 'Ann Bee', value: '1196' }],
    office: [{ label: 'Chicago', value: 'chicago' }],
  },
  sortBy: { value: 'scheduled_date', order: 'desc' },
}

describe('toSavedQuery', () => {
  it('stores dates as offsets from today and selections as bare values', () => {
    expect(toSavedQuery(BOARD, TODAY)).toEqual({
      v: 1,
      dateFromOffsetDays: -1,
      dateToOffsetDays: 14,
      activityTypes: ['PK'],
      shortHaul: ['Y'],
      dispatchers: ['1196'],
      sortBy: { value: 'scheduled_date', order: 'desc' },
    })
  })

  it('never saves the unwired office selection', () => {
    expect(toSavedQuery(BOARD, TODAY)).not.toHaveProperty('office')
  })

  it('saves a cleared date input as today rather than an open bound', () => {
    const cleared = {
      ...BOARD,
      filters: { ...BOARD.filters, date_range: ['', ''] as [string, string] },
    }
    const saved = toSavedQuery(cleared, TODAY)
    expect([saved.dateFromOffsetDays, saved.dateToOffsetDays]).toEqual([0, 0])
  })

  it('keeps a null sort as null', () => {
    expect(toSavedQuery({ ...BOARD, sortBy: null }, TODAY).sortBy).toBeNull()
  })
})

describe('fromSavedQuery', () => {
  it('round-trips the board query, minus office', () => {
    const back = fromSavedQuery(toSavedQuery(BOARD, TODAY), REFS, TODAY)
    expect(back).toEqual({ ...BOARD, filters: { ...BOARD.filters, office: [] } })
  })

  it('re-anchors the window on the day it is loaded', () => {
    const saved = toSavedQuery(BOARD, TODAY)
    expect(fromSavedQuery(saved, REFS, '2026-12-01').filters.date_range).toEqual([
      '2026-11-30',
      '2026-12-15',
    ])
  })

  it('keeps a value missing from the reference list as a code-labelled option', () => {
    const saved = { ...toSavedQuery(BOARD, TODAY), dispatchers: ['9999'] }
    expect(fromSavedQuery(saved, REFS, TODAY).filters.operations_id).toEqual([
      { label: '9999', value: '9999' },
    ])
  })
})

describe('toOptions', () => {
  it('matches codes padded or cased differently', () => {
    expect(toOptions(['pk '], REFS.activityTypes)).toEqual([{ label: 'PK', value: 'PK' }])
  })
})
