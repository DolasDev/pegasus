import { describe, expect, it } from 'vitest'
import { SERVICES_SORT_KEYS, ServicesFilterQuery } from './services-filter-query'
import { ACTIVITY_SORT_KEYS } from '../handlers/longhaul-cloud/activities-list'

const VALID = {
  v: 1,
  dateFromOffsetDays: 0,
  dateToOffsetDays: 7,
  activityTypes: ['PK', 'LD'],
  shortHaul: ['Y'],
  dispatchers: ['1196'],
  sortBy: { value: 'scheduled_date', order: 'desc' },
}

describe('ServicesFilterQuery', () => {
  it('accepts a full query and a null sort', () => {
    expect(ServicesFilterQuery.safeParse(VALID).success).toBe(true)
    expect(ServicesFilterQuery.safeParse({ ...VALID, sortBy: null }).success).toBe(true)
  })

  it('offers exactly the sort keys the activities handler whitelists', () => {
    // A key the handler doesn't know silently falls back to the default order,
    // so a saved sort on it would quietly not apply.
    expect([...SERVICES_SORT_KEYS].sort()).toEqual([...ACTIVITY_SORT_KEYS].sort())
  })

  it.each([
    ['an open date bound', { dateToOffsetDays: null }],
    ['a fractional offset', { dateFromOffsetDays: 0.5 }],
    ['an unknown short-haul value', { shortHaul: ['maybe'] }],
    ['an unknown sort key', { sortBy: { value: 'constructor', order: 'asc' } }],
    ['an office selection (unwired)', { office: ['chicago'] }],
    ['a future version', { v: 2 }],
  ])('rejects %s', (_label, patch) => {
    expect(ServicesFilterQuery.safeParse({ ...VALID, ...patch }).success).toBe(false)
  })
})
