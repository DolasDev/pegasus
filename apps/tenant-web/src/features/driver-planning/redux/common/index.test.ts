import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'

vi.mock('../../utils/api', () => ({
  API: {
    fetchDrivers: vi.fn(),
    fetchTripStatuses: vi.fn(),
    fetchStates: vi.fn(),
    fetchZones: vi.fn(),
    fetchPlanners: vi.fn(),
    fetchDispatchers: vi.fn(),
    fetchFilterOptions: vi.fn(),
    fetchReferenceData: vi.fn(),
  },
}))

import commonReducer, {
  fetchDriversStart,
  fetchDriversSuccess,
  fetchDriversFailure,
  fetchStatusesSuccess,
  fetchStatesSuccess,
  fetchZoneSuccess,
  fetchPlannersSuccess,
  fetchDispatcherSuccess,
  fetchFilterOptionsSuccess,
  fetchDrivers,
  fetchTripStatuses,
  fetchStates,
  fetchZones,
  fetchPlanners,
  fetchDispatchers,
  fetchFilterOptions,
  fetchReferenceData,
  type CommonState,
} from './index'
import { API } from '../../utils/api'

const mockedApi = API as unknown as Record<string, ReturnType<typeof vi.fn>>

function makeStore(preloaded?: Partial<CommonState>) {
  if (!preloaded) {
    return configureStore({ reducer: { common: commonReducer } })
  }
  const base: CommonState = {
    loading: false,
    driversList: [],
    error: false,
    tripStatuses: [],
    stateList: [],
    zoneList: [],
    plannersList: [],
    dispatcherList: [],
  }
  return configureStore({
    reducer: { common: commonReducer },
    preloadedState: { common: { ...base, ...preloaded } },
  })
}

describe('common slice — initial state', () => {
  it('matches the documented defaults', () => {
    const store = makeStore()
    expect(store.getState().common).toEqual({
      loading: false,
      driversList: [],
      error: false,
      tripStatuses: [],
      stateList: [],
      zoneList: [],
      plannersList: [],
      dispatcherList: [],
    })
  })
})

describe('common slice — driver reducers', () => {
  it('fetchDriversStart sets loading=true', () => {
    const store = makeStore()
    store.dispatch(fetchDriversStart())
    expect(store.getState().common.loading).toBe(true)
  })

  it('fetchDriversSuccess trims driver_name and stores list', () => {
    const store = makeStore({ loading: true })
    store.dispatch(
      fetchDriversSuccess([
        { driver_name: '  Alice  ', id: 1 },
        { driver_name: 'Bob', id: 2 },
      ]),
    )
    const { driversList, loading } = store.getState().common
    expect(loading).toBe(false)
    expect(driversList).toHaveLength(2)
    expect(driversList.map((d: any) => d.driver_name)).toEqual(['Alice', 'Bob'])
    // ids are preserved via spread
    expect(driversList.find((d: any) => d.driver_name === 'Alice').id).toBe(1)
  })

  it('fetchDriversSuccess sorts drivers alphabetically by name', () => {
    const store = makeStore()
    store.dispatch(
      fetchDriversSuccess([
        { driver_name: 'Charlie', id: 3 },
        { driver_name: 'Alice', id: 1 },
        { driver_name: 'Bob', id: 2 },
      ]),
    )
    const { driversList } = store.getState().common
    expect(driversList.map((d: any) => d.driver_name)).toEqual(['Alice', 'Bob', 'Charlie'])
    // ids are preserved via spread
    expect(driversList.map((d: any) => d.id)).toEqual([1, 2, 3])
  })

  it('fetchDriversSuccess handles missing driver_name as empty string', () => {
    const store = makeStore()
    store.dispatch(fetchDriversSuccess([{ id: 1 }] as any))
    expect(store.getState().common.driversList[0].driver_name).toBe('')
  })

  it('fetchDriversFailure sets error and clears loading', () => {
    const store = makeStore({ loading: true })
    store.dispatch(fetchDriversFailure('boom'))
    expect(store.getState().common.loading).toBe(false)
    expect(store.getState().common.error).toBe('boom')
  })
})

describe('common slice — list reducers', () => {
  it('fetchStatusesSuccess stores tripStatuses', () => {
    const store = makeStore()
    store.dispatch(fetchStatusesSuccess([{ id: 'A' }, { id: 'B' }]))
    expect(store.getState().common.tripStatuses).toEqual([{ id: 'A' }, { id: 'B' }])
  })

  it('fetchStatesSuccess stores stateList', () => {
    const store = makeStore()
    store.dispatch(fetchStatesSuccess([{ code: 'CA' }]))
    expect(store.getState().common.stateList).toEqual([{ code: 'CA' }])
  })

  it('fetchZoneSuccess stores zoneList', () => {
    const store = makeStore()
    store.dispatch(fetchZoneSuccess([{ id: 'Z1' }]))
    expect(store.getState().common.zoneList).toEqual([{ id: 'Z1' }])
  })

  it('fetchPlannersSuccess stores plannersList', () => {
    const store = makeStore()
    store.dispatch(fetchPlannersSuccess([{ id: 'P1' }]))
    expect(store.getState().common.plannersList).toEqual([{ id: 'P1' }])
  })

  it('fetchDispatcherSuccess stores dispatcherList', () => {
    const store = makeStore()
    store.dispatch(fetchDispatcherSuccess([{ id: 'D1' }]))
    expect(store.getState().common.dispatcherList).toEqual([{ id: 'D1' }])
  })

  it('fetchFilterOptionsSuccess stores filterOptions', () => {
    const store = makeStore()
    store.dispatch(fetchFilterOptionsSuccess({ foo: 'bar' }))
    expect(store.getState().common.filterOptions).toEqual({ foo: 'bar' })
  })
})

describe('common slice — thunks', () => {
  beforeEach(() => {
    Object.values(mockedApi).forEach((fn) => fn.mockReset && fn.mockReset())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetchDrivers: dispatches start + success on resolved call', async () => {
    mockedApi.fetchDrivers.mockResolvedValue([{ driver_name: 'Alice', id: 1 }])
    const store = makeStore()
    await store.dispatch(fetchDrivers() as any)
    expect(mockedApi.fetchDrivers).toHaveBeenCalledTimes(1)
    expect(store.getState().common.driversList).toHaveLength(1)
    expect(store.getState().common.loading).toBe(false)
  })

  it('fetchDrivers: sets loading=true synchronously before resolve', async () => {
    let resolveFn: (v: any) => void = () => {}
    mockedApi.fetchDrivers.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve
      }),
    )
    const store = makeStore()
    const p = store.dispatch(fetchDrivers() as any)
    expect(store.getState().common.loading).toBe(true)
    resolveFn([])
    await p
    expect(store.getState().common.loading).toBe(false)
  })

  it('fetchDrivers: dispatches failure and re-throws on rejected call', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.fetchDrivers.mockRejectedValue(new Error('drivers down'))
    const store = makeStore()
    await expect(store.dispatch(fetchDrivers() as any)).rejects.toThrow('drivers down')
    expect(store.getState().common.loading).toBe(false)
    expect(store.getState().common.error).toBe('drivers down')
    expect(errSpy).toHaveBeenCalled()
  })

  it('fetchTripStatuses: stores result on success', async () => {
    mockedApi.fetchTripStatuses.mockResolvedValue([{ id: 'STATUS' }])
    const store = makeStore()
    await store.dispatch(fetchTripStatuses() as any)
    expect(store.getState().common.tripStatuses).toEqual([{ id: 'STATUS' }])
  })

  it('fetchTripStatuses: logs and re-throws on error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.fetchTripStatuses.mockRejectedValue(new Error('nope'))
    const store = makeStore()
    await expect(store.dispatch(fetchTripStatuses() as any)).rejects.toThrow('nope')
    // state unchanged from initial
    expect(store.getState().common.tripStatuses).toEqual([])
    expect(errSpy).toHaveBeenCalled()
  })

  it('fetchStates: stores result', async () => {
    mockedApi.fetchStates.mockResolvedValue([{ code: 'CA' }])
    const store = makeStore()
    await store.dispatch(fetchStates() as any)
    expect(store.getState().common.stateList).toEqual([{ code: 'CA' }])
  })

  it('fetchStates: logs and re-throws on error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.fetchStates.mockRejectedValue(new Error('states down'))
    const store = makeStore()
    await expect(store.dispatch(fetchStates() as any)).rejects.toThrow('states down')
    expect(store.getState().common.stateList).toEqual([])
    expect(errSpy).toHaveBeenCalled()
  })

  it('fetchZones: stores result', async () => {
    mockedApi.fetchZones.mockResolvedValue([{ id: 'Z' }])
    const store = makeStore()
    await store.dispatch(fetchZones() as any)
    expect(store.getState().common.zoneList).toEqual([{ id: 'Z' }])
  })

  it('fetchZones: logs and re-throws on error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.fetchZones.mockRejectedValue(new Error('zones down'))
    const store = makeStore()
    await expect(store.dispatch(fetchZones() as any)).rejects.toThrow('zones down')
    expect(store.getState().common.zoneList).toEqual([])
    expect(errSpy).toHaveBeenCalled()
  })

  it('fetchPlanners: stores result', async () => {
    mockedApi.fetchPlanners.mockResolvedValue([{ id: 'P' }])
    const store = makeStore()
    await store.dispatch(fetchPlanners() as any)
    expect(store.getState().common.plannersList).toEqual([{ id: 'P' }])
  })

  it('fetchPlanners: logs and re-throws on error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.fetchPlanners.mockRejectedValue(new Error('planners down'))
    const store = makeStore()
    await expect(store.dispatch(fetchPlanners() as any)).rejects.toThrow('planners down')
    expect(store.getState().common.plannersList).toEqual([])
    expect(errSpy).toHaveBeenCalled()
  })

  it('fetchDispatchers: stores result', async () => {
    mockedApi.fetchDispatchers.mockResolvedValue([{ id: 'D' }])
    const store = makeStore()
    await store.dispatch(fetchDispatchers() as any)
    expect(store.getState().common.dispatcherList).toEqual([{ id: 'D' }])
  })

  it('fetchDispatchers: logs and re-throws on error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.fetchDispatchers.mockRejectedValue(new Error('dispatchers down'))
    const store = makeStore()
    await expect(store.dispatch(fetchDispatchers() as any)).rejects.toThrow('dispatchers down')
    expect(store.getState().common.dispatcherList).toEqual([])
    expect(errSpy).toHaveBeenCalled()
  })

  it('fetchFilterOptions: stores result', async () => {
    mockedApi.fetchFilterOptions.mockResolvedValue({ haulModes: ['LH'] })
    const store = makeStore()
    await store.dispatch(fetchFilterOptions() as any)
    expect(store.getState().common.filterOptions).toEqual({ haulModes: ['LH'] })
  })

  it('fetchFilterOptions: logs and re-throws on error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.fetchFilterOptions.mockRejectedValue(new Error('options down'))
    const store = makeStore()
    await expect(store.dispatch(fetchFilterOptions() as any)).rejects.toThrow('options down')
    expect(store.getState().common.filterOptions).toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
  })

  it('fetchReferenceData: dispatches all 7 success reducers from a single payload', async () => {
    mockedApi.fetchReferenceData.mockResolvedValue({
      drivers: [{ driver_name: 'Alice', id: 1 }],
      tripStatuses: [{ id: 'PLANNED' }],
      states: [{ code: 'CA' }],
      zones: [{ id: 'Z1' }],
      planners: [{ id: 'P1' }],
      dispatchers: [{ id: 'D1' }],
      filterOptions: { moveType: [{ value: 'L', label: 'Local' }] },
    })
    const store = makeStore()
    await store.dispatch(fetchReferenceData() as any)
    expect(mockedApi.fetchReferenceData).toHaveBeenCalledTimes(1)
    const s = store.getState().common
    expect(s.driversList).toHaveLength(1)
    expect(s.driversList[0].driver_name).toBe('Alice')
    expect(s.tripStatuses).toEqual([{ id: 'PLANNED' }])
    expect(s.stateList).toEqual([{ code: 'CA' }])
    expect(s.zoneList).toEqual([{ id: 'Z1' }])
    expect(s.plannersList).toEqual([{ id: 'P1' }])
    expect(s.dispatcherList).toEqual([{ id: 'D1' }])
    expect(s.filterOptions).toEqual({ moveType: [{ value: 'L', label: 'Local' }] })
  })

  it('fetchReferenceData: handles the empty-client degraded shape', async () => {
    // When the tenant has no longhaulClient the server returns empty
    // dispatchers + empty filterOptions; the thunk must still dispatch ALL
    // seven success actions so the slice doesn't keep stale values.
    mockedApi.fetchReferenceData.mockResolvedValue({
      drivers: [],
      tripStatuses: [],
      states: [],
      zones: [],
      planners: [],
      dispatchers: [],
      filterOptions: { moveType: [] },
    })
    const store = makeStore({ dispatcherList: [{ id: 'STALE' }] })
    await store.dispatch(fetchReferenceData() as any)
    expect(store.getState().common.dispatcherList).toEqual([])
    expect(store.getState().common.filterOptions).toEqual({ moveType: [] })
  })

  it('fetchReferenceData: logs and re-throws on error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.fetchReferenceData.mockRejectedValue(new Error('ref data down'))
    const store = makeStore()
    await expect(store.dispatch(fetchReferenceData() as any)).rejects.toThrow('ref data down')
    expect(errSpy).toHaveBeenCalled()
  })

  it('fetchReferenceData: MSSQL_NOT_CONFIGURED degrades to empty, does not throw or log', async () => {
    // A tenant with no legacy DB must not error the Operations bootstrap — the
    // thunk swallows MSSQL_NOT_CONFIGURED, leaves every slice empty (clearing
    // any stale values), and does NOT re-throw so AppGuard shows no toast.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('Legacy database not configured for this tenant') as Error & {
      code?: string
    }
    err.code = 'MSSQL_NOT_CONFIGURED'
    mockedApi.fetchReferenceData.mockRejectedValue(err)
    const store = makeStore({
      loading: true,
      driversList: [{ driver_name: 'Stale', id: 9 }],
      dispatcherList: [{ id: 'STALE' }],
    })

    await expect(store.dispatch(fetchReferenceData() as any)).resolves.toBeUndefined()

    const s = store.getState().common
    expect(s.driversList).toEqual([])
    expect(s.dispatcherList).toEqual([])
    expect(s.tripStatuses).toEqual([])
    expect(s.stateList).toEqual([])
    expect(s.zoneList).toEqual([])
    expect(s.plannersList).toEqual([])
    expect(s.filterOptions).toEqual({ moveType: [] })
    expect(s.loading).toBe(false)
    expect(errSpy).not.toHaveBeenCalled()
  })
})
