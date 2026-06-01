import { configureStore } from '@reduxjs/toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The slice's API module transitively imports a real fetch transport.
vi.mock('../../utils/api', () => ({
  API: {
    fetchTrips: vi.fn(),
    saveActivity: vi.fn(),
  },
}))

import { API } from '../../utils/api'
import tripsReducer, {
  selectTrip,
  changeTripsQuery,
  editTrip,
  fetchTrips,
  updateActivityForTrip,
  type TripsState,
} from './index'

const mockedFetchTrips = API.fetchTrips as unknown as ReturnType<typeof vi.fn>
const mockedSaveActivity = API.saveActivity as unknown as ReturnType<typeof vi.fn>

function makeStore() {
  return configureStore({ reducer: { trips: tripsReducer } })
}

function getTrips(store: ReturnType<typeof makeStore>): TripsState {
  return store.getState().trips
}

beforeEach(() => {
  vi.clearAllMocks()
  // Silence expected console.error noise from the rejection paths.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('trips slice — initial state', () => {
  it('exposes a sane default shape', () => {
    const state = getTrips(makeStore())
    expect(state.loading).toBe(false)
    expect(state.selectedTrip).toBeNull()
    expect(state.tripList).toEqual([])
    expect(state.error).toBeNull()
    expect(state.query).toMatchObject({
      searchTerm: '',
      sortBy: { value: 'planned_first_day', order: 'desc' },
    })
    expect(state.query.filters.TripStatus_id).toHaveLength(4)
    expect(state.query.filters.internal_status).toEqual([{ value: 'active', label: 'yes' }])
  })
})

describe('trips slice — selectTrip reducer', () => {
  it('stores the selected trip', () => {
    const store = makeStore()
    const trip = { id: 1, name: 'Trip A' }
    store.dispatch(selectTrip(trip))
    expect(getTrips(store).selectedTrip).toEqual(trip)
  })

  it('overwrites a previously selected trip', () => {
    const store = makeStore()
    store.dispatch(selectTrip({ id: 1 }))
    store.dispatch(selectTrip({ id: 2 }))
    expect(getTrips(store).selectedTrip).toEqual({ id: 2 })
  })

  it('accepts null to clear the selection', () => {
    const store = makeStore()
    store.dispatch(selectTrip({ id: 1 }))
    store.dispatch(selectTrip(null))
    expect(getTrips(store).selectedTrip).toBeNull()
  })
})

describe('trips slice — changeTripsQuery reducer', () => {
  it('shallow-merges searchTerm into the query', () => {
    const store = makeStore()
    store.dispatch(changeTripsQuery({ searchTerm: 'foo' }))
    const q = getTrips(store).query
    expect(q.searchTerm).toBe('foo')
    expect(q.sortBy).toEqual({ value: 'planned_first_day', order: 'desc' })
    expect(q.filters.TripStatus_id).toHaveLength(4)
  })

  it('replaces sortBy without touching searchTerm or filters', () => {
    const store = makeStore()
    store.dispatch(changeTripsQuery({ searchTerm: 'foo' }))
    store.dispatch(
      changeTripsQuery({ sortBy: { value: 'driver_name', order: 'asc' } }),
    )
    const q = getTrips(store).query
    expect(q.sortBy).toEqual({ value: 'driver_name', order: 'asc' })
    expect(q.searchTerm).toBe('foo')
    expect(q.filters.TripStatus_id).toHaveLength(4)
  })

  it('replaces the entire filters object when filters key is provided (shallow merge)', () => {
    const store = makeStore()
    store.dispatch(
      changeTripsQuery({
        filters: { TripStatus_id: [{ value: 5, label: 'Completed' }] },
      }),
    )
    const q = getTrips(store).query
    expect(q.filters).toEqual({
      TripStatus_id: [{ value: 5, label: 'Completed' }],
    })
    expect(q.searchTerm).toBe('')
  })

  it('handles an empty payload as a no-op merge', () => {
    const store = makeStore()
    const before = getTrips(store).query
    store.dispatch(changeTripsQuery({}))
    const after = getTrips(store).query
    expect(after).toEqual(before)
  })
})

describe('trips slice — editTrip reducer', () => {
  it('merges patch into selectedTrip', () => {
    const store = makeStore()
    store.dispatch(selectTrip({ id: 1, name: 'Old', driver: 'Alice' }))
    store.dispatch(editTrip({ name: 'New' }))
    expect(getTrips(store).selectedTrip).toEqual({
      id: 1,
      name: 'New',
      driver: 'Alice',
    })
  })

  it('creates a selectedTrip from the patch when none was selected', () => {
    // The reducer now explicitly guards `selectedTrip ?? {}` so spreading
    // onto a null selection is part of the documented contract, not an
    // accident of `{ ...null }` evaluating to `{}`.
    const store = makeStore()
    expect(getTrips(store).selectedTrip).toBeNull()
    store.dispatch(editTrip({ id: 7, foo: 'bar' }))
    expect(getTrips(store).selectedTrip).toEqual({ id: 7, foo: 'bar' })
  })

  it('supports successive edits', () => {
    const store = makeStore()
    store.dispatch(selectTrip({ id: 1 }))
    store.dispatch(editTrip({ a: 1 }))
    store.dispatch(editTrip({ b: 2 }))
    expect(getTrips(store).selectedTrip).toEqual({ id: 1, a: 1, b: 2 })
  })
})

describe('trips slice — fetchTrips thunk', () => {
  it('flips loading on, calls API, and stores the resulting list', async () => {
    const store = makeStore()
    const trips = [{ id: 1 }, { id: 2 }]
    let resolveFn: (v: any) => void = () => {}
    mockedFetchTrips.mockReturnValueOnce(
      new Promise<any>((resolve) => {
        resolveFn = resolve
      }),
    )

    const query = { searchTerm: 'abc' }
    const promise = store.dispatch(fetchTrips(query) as any)

    expect(getTrips(store).loading).toBe(true)
    expect(getTrips(store).tripList).toEqual([])

    resolveFn(trips)
    await promise

    expect(mockedFetchTrips).toHaveBeenCalledTimes(1)
    expect(mockedFetchTrips).toHaveBeenCalledWith(query)
    expect(getTrips(store).loading).toBe(false)
    expect(getTrips(store).tripList).toEqual(trips)
    expect(getTrips(store).error).toBeNull()
  })

  it('records the error message and clears loading on rejection', async () => {
    const store = makeStore()
    mockedFetchTrips.mockRejectedValueOnce(new Error('boom'))

    await store.dispatch(fetchTrips({}) as any)

    const state = getTrips(store)
    expect(state.loading).toBe(false)
    expect(state.error).toBe('boom')
    expect(state.tripList).toEqual([])
  })

  it('does not throw on rejection (errors are caught inside the thunk)', async () => {
    const store = makeStore()
    mockedFetchTrips.mockRejectedValueOnce(new Error('nope'))
    await expect(store.dispatch(fetchTrips({}) as any)).resolves.toBeUndefined()
  })

  it('overwrites tripList on successive successful fetches', async () => {
    const store = makeStore()
    mockedFetchTrips.mockResolvedValueOnce([{ id: 1 }])
    await store.dispatch(fetchTrips({}) as any)
    expect(getTrips(store).tripList).toEqual([{ id: 1 }])

    mockedFetchTrips.mockResolvedValueOnce([{ id: 2 }, { id: 3 }])
    await store.dispatch(fetchTrips({}) as any)
    expect(getTrips(store).tripList).toEqual([{ id: 2 }, { id: 3 }])
  })
})

describe('trips slice — updateActivityForTrip thunk', () => {
  it('forwards activityId + activity to API.saveActivity', async () => {
    const store = makeStore()
    mockedSaveActivity.mockResolvedValueOnce(undefined)

    await store.dispatch(
      updateActivityForTrip('act-1', { foo: 'bar' }) as any,
    )

    expect(mockedSaveActivity).toHaveBeenCalledTimes(1)
    expect(mockedSaveActivity).toHaveBeenCalledWith('act-1', { foo: 'bar' })
  })

  it('swallows API errors (logged, never rethrown) and does not mutate state', async () => {
    const store = makeStore()
    mockedSaveActivity.mockRejectedValueOnce(new Error('save failed'))
    const before = getTrips(store)

    await expect(
      store.dispatch(updateActivityForTrip('act-2', {}) as any),
    ).resolves.toBeUndefined()

    expect(getTrips(store)).toEqual(before)
  })
})
