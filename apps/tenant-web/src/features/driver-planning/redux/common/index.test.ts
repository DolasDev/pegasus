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
    expect(driversList.map((d: any) => d.driver_name).sort()).toEqual(['Alice', 'Bob'])
    // ids are preserved via spread
    expect(driversList.find((d: any) => d.driver_name === 'Alice').id).toBe(1)
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

  it('fetchDrivers: dispatches failure on rejected call', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.fetchDrivers.mockRejectedValue(new Error('drivers down'))
    const store = makeStore()
    await store.dispatch(fetchDrivers() as any)
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

  it('fetchTripStatuses: swallows error and logs', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.fetchTripStatuses.mockRejectedValue(new Error('nope'))
    const store = makeStore()
    await store.dispatch(fetchTripStatuses() as any)
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

  it('fetchStates: swallows error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.fetchStates.mockRejectedValue(new Error('states down'))
    const store = makeStore()
    await store.dispatch(fetchStates() as any)
    expect(store.getState().common.stateList).toEqual([])
    expect(errSpy).toHaveBeenCalled()
  })

  it('fetchZones: stores result', async () => {
    mockedApi.fetchZones.mockResolvedValue([{ id: 'Z' }])
    const store = makeStore()
    await store.dispatch(fetchZones() as any)
    expect(store.getState().common.zoneList).toEqual([{ id: 'Z' }])
  })

  it('fetchZones: swallows error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.fetchZones.mockRejectedValue(new Error('zones down'))
    const store = makeStore()
    await store.dispatch(fetchZones() as any)
    expect(store.getState().common.zoneList).toEqual([])
    expect(errSpy).toHaveBeenCalled()
  })

  it('fetchPlanners: stores result', async () => {
    mockedApi.fetchPlanners.mockResolvedValue([{ id: 'P' }])
    const store = makeStore()
    await store.dispatch(fetchPlanners() as any)
    expect(store.getState().common.plannersList).toEqual([{ id: 'P' }])
  })

  it('fetchPlanners: swallows error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.fetchPlanners.mockRejectedValue(new Error('planners down'))
    const store = makeStore()
    await store.dispatch(fetchPlanners() as any)
    expect(store.getState().common.plannersList).toEqual([])
    expect(errSpy).toHaveBeenCalled()
  })

  it('fetchDispatchers: stores result', async () => {
    mockedApi.fetchDispatchers.mockResolvedValue([{ id: 'D' }])
    const store = makeStore()
    await store.dispatch(fetchDispatchers() as any)
    expect(store.getState().common.dispatcherList).toEqual([{ id: 'D' }])
  })

  it('fetchDispatchers: swallows error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.fetchDispatchers.mockRejectedValue(new Error('dispatchers down'))
    const store = makeStore()
    await store.dispatch(fetchDispatchers() as any)
    expect(store.getState().common.dispatcherList).toEqual([])
    expect(errSpy).toHaveBeenCalled()
  })

  it('fetchFilterOptions: stores result', async () => {
    mockedApi.fetchFilterOptions.mockResolvedValue({ haulModes: ['LH'] })
    const store = makeStore()
    await store.dispatch(fetchFilterOptions() as any)
    expect(store.getState().common.filterOptions).toEqual({ haulModes: ['LH'] })
  })

  it('fetchFilterOptions: swallows error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.fetchFilterOptions.mockRejectedValue(new Error('options down'))
    const store = makeStore()
    await store.dispatch(fetchFilterOptions() as any)
    expect(store.getState().common.filterOptions).toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
  })
})
