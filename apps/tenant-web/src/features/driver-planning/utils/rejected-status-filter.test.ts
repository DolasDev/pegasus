import { describe, it, expect } from 'vitest'
import {
  REJECTED_STATUS_OPTION,
  REJECTED_STATUS_VALUE,
  splitRejectedStatus,
} from './rejected-status-filter'

const baseQuery = (statuses: any[]) => ({
  searchTerm: '',
  filters: { TripStatus_id: statuses, internal_status: [{ value: 'active' }] },
  sortBy: { value: 'planned_first_day', order: 'desc' },
})

describe('splitRejectedStatus', () => {
  it('leaves a query without the sentinel untouched', () => {
    const query = baseQuery([{ value: 1, label: 'Pending' }])
    const { liveQuery, includesRejected, onlyRejected } = splitRejectedStatus(query)

    expect(liveQuery).toBe(query)
    expect(includesRejected).toBe(false)
    expect(onlyRejected).toBe(false)
  })

  it('tolerates a missing / non-array status filter', () => {
    expect(splitRejectedStatus({ filters: {} }).includesRejected).toBe(false)
    expect(splitRejectedStatus({}).includesRejected).toBe(false)
    expect(splitRejectedStatus(undefined).includesRejected).toBe(false)
    expect(splitRejectedStatus({ filters: { TripStatus_id: 'nonsense' } }).includesRejected).toBe(
      false,
    )
  })

  it('strips the sentinel and keeps the real statuses', () => {
    const query = baseQuery([{ value: 1, label: 'Pending' }, REJECTED_STATUS_OPTION])
    const { liveQuery, includesRejected, onlyRejected } = splitRejectedStatus(query)

    expect(liveQuery.filters.TripStatus_id).toEqual([{ value: 1, label: 'Pending' }])
    expect(includesRejected).toBe(true)
    expect(onlyRejected).toBe(false)
    // Other filters and the rest of the query survive the split.
    expect(liveQuery.filters.internal_status).toEqual([{ value: 'active' }])
    expect(liveQuery.sortBy).toEqual(query.sortBy)
  })

  it('does not mutate the source query', () => {
    const query = baseQuery([REJECTED_STATUS_OPTION, { value: 2 }])
    splitRejectedStatus(query)
    expect(query.filters.TripStatus_id).toHaveLength(2)
  })

  it('reports onlyRejected when the sentinel is the sole selection', () => {
    const { liveQuery, includesRejected, onlyRejected } = splitRejectedStatus(
      baseQuery([REJECTED_STATUS_OPTION]),
    )

    expect(liveQuery.filters.TripStatus_id).toEqual([])
    expect(includesRejected).toBe(true)
    expect(onlyRejected).toBe(true)
  })

  it('matches a bare sentinel value as well as an option object', () => {
    const { includesRejected, onlyRejected } = splitRejectedStatus(
      baseQuery([REJECTED_STATUS_VALUE]),
    )
    expect(includesRejected).toBe(true)
    expect(onlyRejected).toBe(true)
  })
})
