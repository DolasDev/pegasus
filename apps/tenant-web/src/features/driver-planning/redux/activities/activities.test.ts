import { configureStore, type EnhancedStore } from '@reduxjs/toolkit'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../utils/api', () => ({
  API: { fetchActivities: vi.fn() },
}))

import { API } from '../../utils/api'
import activitiesReducer, {
  ACTIVITIES_DEFAULT_RANGE_DAYS,
  DEFAULT_ACTIVITY_QUERY,
  activityDateOffset,
  buildActivityRequest,
  changeActivityQuery,
  fetchActivities,
  fetchActivitiesFailure,
  fetchActivitiesStart,
  fetchActivitiesSuccess,
  resetActivityQuery,
  type ActivitiesState,
} from './index'

const fetchActivitiesMock = API.fetchActivities as unknown as ReturnType<typeof vi.fn>

function makeStore(
  preloaded?: Partial<ActivitiesState>,
): EnhancedStore<{ activities: ActivitiesState }> {
  const base: ActivitiesState = {
    loading: false,
    activityList: [],
    query: structuredClone(DEFAULT_ACTIVITY_QUERY),
    error: null,
  }
  return configureStore({
    reducer: { activities: activitiesReducer },
    preloadedState: { activities: { ...base, ...preloaded } },
  })
}

describe('activityDateOffset', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats today as YYYY-MM-DD', () => {
    vi.setSystemTime(new Date(2026, 8, 10, 12, 0, 0))

    expect(activityDateOffset(0)).toBe('2026-09-10')
  })

  it('zero-pads single-digit months and days', () => {
    vi.setSystemTime(new Date(2026, 0, 5, 12, 0, 0))

    expect(activityDateOffset(0)).toBe('2026-01-05')
  })

  it('rolls forward across a month boundary', () => {
    vi.setSystemTime(new Date(2026, 8, 28, 12, 0, 0))

    expect(activityDateOffset(7)).toBe('2026-10-05')
  })
})

describe('activities query', () => {
  it('opens on a bounded default window rather than everything', () => {
    // Unbounded, this board exceeds the API's 1000-row cap and greets the
    // dispatcher with an error instead of their work.
    const [from, to] = DEFAULT_ACTIVITY_QUERY.filters.date_range
    expect(from).toBe(activityDateOffset(0))
    expect(to).toBe(activityDateOffset(ACTIVITIES_DEFAULT_RANGE_DAYS))
  })

  it('deep-merges a partial filter payload instead of replacing the object', () => {
    const store = makeStore()

    store.dispatch(changeActivityQuery({ filters: { short_haul: [{ label: 'Yes', value: 'Y' }] } }))

    const { filters } = store.getState().activities.query
    expect(filters.short_haul).toEqual([{ label: 'Yes', value: 'Y' }])
    // The untouched filters survive.
    expect(filters.date_range).toEqual(DEFAULT_ACTIVITY_QUERY.filters.date_range)
    expect(filters.activity_type).toEqual([])
  })

  it('records sortBy without disturbing the filters', () => {
    const store = makeStore()

    store.dispatch(changeActivityQuery({ sortBy: { value: 'order_num', order: 'desc' } }))

    expect(store.getState().activities.query.sortBy).toEqual({
      value: 'order_num',
      order: 'desc',
    })
    expect(store.getState().activities.query.filters.date_range).toEqual(
      DEFAULT_ACTIVITY_QUERY.filters.date_range,
    )
  })

  it('resets to a range derived from TODAY, not from module load', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 8, 10, 12, 0, 0))
      const store = makeStore({
        query: {
          filters: {
            date_range: ['2020-01-01', '2020-01-02'],
            activity_type: [{ label: 'Pack', value: 'PACK' }],
            short_haul: [],
            operations_id: [],
            office: [],
          },
          sortBy: { value: 'order_num', order: 'asc' },
        },
      })

      // A board left open overnight must reset to the NEW today.
      vi.setSystemTime(new Date(2026, 8, 11, 12, 0, 0))
      store.dispatch(resetActivityQuery())

      const { query } = store.getState().activities
      expect(query.filters.date_range).toEqual(['2026-09-11', '2026-09-18'])
      expect(query.filters.activity_type).toEqual([])
      expect(query.sortBy).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('buildActivityRequest', () => {
  it('never sends office — the filter is mocked, and a silently-ignored key lies', () => {
    const request = buildActivityRequest({
      ...DEFAULT_ACTIVITY_QUERY,
      filters: {
        ...DEFAULT_ACTIVITY_QUERY.filters,
        office: [{ label: 'Chicago', value: 'chicago' }],
      },
    }) as any

    expect(request.filters).not.toHaveProperty('office')
  })

  it('sends every wired filter through untouched', () => {
    const request = buildActivityRequest({
      filters: {
        date_range: ['2026-09-10', '2026-09-17'],
        activity_type: [{ label: 'Pack', value: 'PACK' }],
        short_haul: [{ label: 'Yes', value: 'Y' }],
        operations_id: [{ label: 'A B', value: '1196' }],
        office: [],
      },
      sortBy: { value: 'order_num', order: 'desc' },
    }) as any

    expect(request).toEqual({
      filters: {
        date_range: ['2026-09-10', '2026-09-17'],
        activity_type: [{ label: 'Pack', value: 'PACK' }],
        short_haul: [{ label: 'Yes', value: 'Y' }],
        operations_id: [{ label: 'A B', value: '1196' }],
      },
      sortBy: { value: 'order_num', order: 'desc' },
    })
  })
})

describe('activities reducers', () => {
  it('flags loading on start', () => {
    const store = makeStore()

    store.dispatch(fetchActivitiesStart())

    expect(store.getState().activities.loading).toBe(true)
  })

  it('stores the list and clears a prior error on success', () => {
    const store = makeStore({ loading: true, error: 'boom' })

    store.dispatch(fetchActivitiesSuccess([{ id: 1 }, { id: 2 }] as any))

    expect(store.getState().activities).toMatchObject({
      loading: false,
      error: null,
      activityList: [{ id: 1 }, { id: 2 }],
    })
  })

  it('coerces a non-array payload so the board cannot crash on .map', () => {
    const store = makeStore()

    store.dispatch(fetchActivitiesSuccess(null as any))

    expect(store.getState().activities.activityList).toEqual([])
  })

  it('empties the list on failure so no stale rows sit under an error', () => {
    const store = makeStore({ activityList: [{ id: 1 }] })

    store.dispatch(fetchActivitiesFailure('Too many activities'))

    expect(store.getState().activities).toMatchObject({
      loading: false,
      error: 'Too many activities',
      activityList: [],
    })
  })
})

describe('fetchActivities thunk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls the API with the stripped request and stores the rows', async () => {
    fetchActivitiesMock.mockResolvedValue([{ id: 9 }])
    const store = makeStore()

    await store.dispatch(fetchActivities(store.getState().activities.query) as any)

    expect(fetchActivitiesMock).toHaveBeenCalledWith(
      buildActivityRequest(DEFAULT_ACTIVITY_QUERY as any),
    )
    expect(store.getState().activities.activityList).toEqual([{ id: 9 }])
  })

  it('surfaces the API message so RESULT_LIMIT_EXCEEDED reaches the dispatcher', async () => {
    fetchActivitiesMock.mockRejectedValue(
      new Error('Too many activities — please narrow your date range or filters.'),
    )
    const store = makeStore()

    await store.dispatch(fetchActivities(store.getState().activities.query) as any)

    expect(store.getState().activities.error).toBe(
      'Too many activities — please narrow your date range or filters.',
    )
  })

  it('falls back to a generic message when the error carries none', async () => {
    fetchActivitiesMock.mockRejectedValue({})
    const store = makeStore()

    await store.dispatch(fetchActivities(store.getState().activities.query) as any)

    expect(store.getState().activities.error).toBe('Failed to fetch activities')
  })
})
