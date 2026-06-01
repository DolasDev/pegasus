import { configureStore, type EnhancedStore } from '@reduxjs/toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../utils/api', () => ({
  API: {
    fetchShipments: vi.fn(),
    saveShipmentCoverage: vi.fn(),
    patchShipmentShadow: vi.fn(),
    fetchShipmentDefaultFilterForUser: vi.fn(),
    deleteShipmentFilter: vi.fn(),
  },
}))

vi.mock('../../components/Snackbar/notify', () => ({
  notifyError: vi.fn(),
}))

import { API } from '../../utils/api'
import { notifyError } from '../../components/Snackbar/notify'
import shipmentsReducer, {
  changeShipmentQuery,
  deleteShipmentFilter,
  fetchShipmentFailure,
  fetchShipments,
  fetchShipmentsFailure,
  fetchShipmentsStart,
  fetchShipmentsSuccess,
  fetchShipmentStart,
  fetchShipmentSuccess,
  loadDefaultFilter,
  patchShipmentShadow,
  resetToDefaultShipmentQuery,
  saveShipmentCoverage,
  selectShipment,
  type ShipmentsState,
} from './index'

const makeStore = (preloadedShipments?: Partial<ShipmentsState>): EnhancedStore<{ shipments: ShipmentsState }> => {
  const base: ShipmentsState = {
    loading: false,
    loadingSelectedShipment: false,
    selectedShipment: null,
    shipmentList: [],
    query: { searchTerm: '', filters: {}, sortBy: {} },
    haulModes: [],
    pegasus_shadow: {},
    error: false,
  }
  return configureStore({
    reducer: { shipments: shipmentsReducer },
    preloadedState: { shipments: { ...base, ...preloadedShipments } },
  })
}

const mockedAPI = API as unknown as {
  fetchShipments: ReturnType<typeof vi.fn>
  saveShipmentCoverage: ReturnType<typeof vi.fn>
  patchShipmentShadow: ReturnType<typeof vi.fn>
  fetchShipmentDefaultFilterForUser: ReturnType<typeof vi.fn>
  deleteShipmentFilter: ReturnType<typeof vi.fn>
}

const mockedNotifyError = notifyError as unknown as ReturnType<typeof vi.fn>

// Silences console.error for the duration of a test (thunks log on rejection).
const silenceConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('shipments slice — initialState', () => {
  it('exposes the documented default state shape', () => {
    const store = configureStore({ reducer: { shipments: shipmentsReducer } })
    const state = store.getState().shipments
    expect(state.loading).toBe(false)
    expect(state.loadingSelectedShipment).toBe(false)
    expect(state.selectedShipment).toBeNull()
    expect(state.shipmentList).toEqual([])
    expect(state.haulModes).toEqual([])
    expect(state.pegasus_shadow).toEqual({})
    expect(state.error).toBe(false)
    // Default query has the documented filter keys.
    expect(state.query.searchTerm).toBe('')
    expect(state.query.filters.Is_Trip_Planning).toBe(true)
    expect(Array.isArray(state.query.filters.load_date)).toBe(true)
    expect(state.query.filters.load_date).toHaveLength(2)
    expect(state.query.filters.assigned).toEqual([{ label: 'No', value: 'No' }])
    expect(state.query.sortBy).toEqual({})
  })
})

describe('shipments slice — fetch reducers', () => {
  it('fetchShipmentsStart sets loading=true', () => {
    const store = makeStore()
    store.dispatch(fetchShipmentsStart())
    expect(store.getState().shipments.loading).toBe(true)
  })

  it('fetchShipmentsSuccess stores list and clears loading', () => {
    const store = makeStore({ loading: true })
    const list = [{ order_num: 1 }, { order_num: 2 }]
    store.dispatch(fetchShipmentsSuccess(list))
    expect(store.getState().shipments.shipmentList).toEqual(list)
    expect(store.getState().shipments.loading).toBe(false)
  })

  it('fetchShipmentsSuccess accepts an empty list', () => {
    const store = makeStore({ loading: true, shipmentList: [{ order_num: 99 }] })
    store.dispatch(fetchShipmentsSuccess([]))
    expect(store.getState().shipments.shipmentList).toEqual([])
    expect(store.getState().shipments.loading).toBe(false)
  })

  it('fetchShipmentsFailure stores error and clears loading', () => {
    const store = makeStore({ loading: true })
    store.dispatch(fetchShipmentsFailure('boom'))
    expect(store.getState().shipments.error).toBe('boom')
    expect(store.getState().shipments.loading).toBe(false)
  })

  it('fetchShipmentStart sets loadingSelectedShipment=true', () => {
    const store = makeStore()
    store.dispatch(fetchShipmentStart())
    expect(store.getState().shipments.loadingSelectedShipment).toBe(true)
  })

  it('fetchShipmentSuccess stores selectedShipment and clears its loading flag', () => {
    const store = makeStore({ loadingSelectedShipment: true })
    const ship = { order_num: 42, customer: 'Acme' }
    store.dispatch(fetchShipmentSuccess(ship))
    expect(store.getState().shipments.selectedShipment).toEqual(ship)
    expect(store.getState().shipments.loadingSelectedShipment).toBe(false)
  })

  it('fetchShipmentSuccess accepts null payload (clear-selection path)', () => {
    const store = makeStore({ selectedShipment: { order_num: 1 }, loadingSelectedShipment: true })
    store.dispatch(fetchShipmentSuccess(null))
    expect(store.getState().shipments.selectedShipment).toBeNull()
    expect(store.getState().shipments.loadingSelectedShipment).toBe(false)
  })

  it('fetchShipmentFailure stores error and clears loadingSelectedShipment', () => {
    const store = makeStore({ loadingSelectedShipment: true })
    store.dispatch(fetchShipmentFailure('nope'))
    expect(store.getState().shipments.error).toBe('nope')
    expect(store.getState().shipments.loadingSelectedShipment).toBe(false)
  })
})

describe('shipments slice — query reducers', () => {
  it('changeShipmentQuery merges into existing query', () => {
    const store = makeStore({ query: { searchTerm: 'foo', filters: { a: 1 }, sortBy: {} } })
    store.dispatch(changeShipmentQuery({ searchTerm: 'bar' }))
    expect(store.getState().shipments.query.searchTerm).toBe('bar')
    expect(store.getState().shipments.query.filters).toEqual({ a: 1 })
  })

  it('changeShipmentQuery overwrites nested keys (shallow merge)', () => {
    const store = makeStore({ query: { searchTerm: '', filters: { a: 1 }, sortBy: {} } })
    store.dispatch(changeShipmentQuery({ filters: { b: 2 } }))
    // shallow merge — filters is replaced, not deep-merged
    expect(store.getState().shipments.query.filters).toEqual({ b: 2 })
  })

  it('changeShipmentQuery accepts empty payload', () => {
    const store = makeStore({ query: { searchTerm: 'keep', filters: {}, sortBy: {} } })
    store.dispatch(changeShipmentQuery({}))
    expect(store.getState().shipments.query.searchTerm).toBe('keep')
  })

  it('resetToDefaultShipmentQuery resets to a fresh default query', () => {
    const store = makeStore({ query: { searchTerm: 'mutated', filters: {}, sortBy: {} } })
    store.dispatch(resetToDefaultShipmentQuery())
    const q = store.getState().shipments.query
    expect(q.searchTerm).toBe('')
    expect(q.filters.Is_Trip_Planning).toBe(true)
    expect(q.filters.assigned).toEqual([{ label: 'No', value: 'No' }])
  })

  it('resetToDefaultShipmentQuery clones (new dispatches do not share refs across stores)', () => {
    const a = makeStore()
    const b = makeStore()
    a.dispatch(resetToDefaultShipmentQuery())
    b.dispatch(resetToDefaultShipmentQuery())
    // Mutating one store's filter array should not bleed into the other.
    expect(a.getState().shipments.query.filters.assigned).not.toBe(
      b.getState().shipments.query.filters.assigned,
    )
  })
})

describe('shipments slice — saveShipmentCoverage reducer', () => {
  it('updates packing_coverage on the matching shipment in the list', () => {
    const store = makeStore({
      shipmentList: [
        { order_num: 'A', packing_coverage: { old: true } },
        { order_num: 'B', packing_coverage: { old: true } },
      ],
    })
    const dto = { order_num: 'B', new: true }
    store.dispatch(saveShipmentCoverage(dto))
    const list = store.getState().shipments.shipmentList
    expect(list[0].packing_coverage).toEqual({ old: true })
    expect(list[1].packing_coverage).toEqual(dto)
  })

  it('calls API.saveShipmentCoverage with the dto', () => {
    const store = makeStore({
      shipmentList: [{ order_num: 'A', packing_coverage: {} }],
    })
    const dto = { order_num: 'A', tier: 'gold' }
    store.dispatch(saveShipmentCoverage(dto))
    expect(mockedAPI.saveShipmentCoverage).toHaveBeenCalledWith(dto)
  })

  it('does not throw when shipment is not found in the list', () => {
    const store = makeStore({ shipmentList: [{ order_num: 'A', packing_coverage: {} }] })
    expect(() => store.dispatch(saveShipmentCoverage({ order_num: 'Z' }))).not.toThrow()
    // unchanged
    expect(store.getState().shipments.shipmentList[0].packing_coverage).toEqual({})
    // API still called even when match missing (current behavior)
    expect(mockedAPI.saveShipmentCoverage).toHaveBeenCalledTimes(1)
  })

  it('does nothing to the list when matched shipment has no packing_coverage field', () => {
    const store = makeStore({ shipmentList: [{ order_num: 'A' }] })
    store.dispatch(saveShipmentCoverage({ order_num: 'A', tier: 'gold' }))
    expect(store.getState().shipments.shipmentList[0]).toEqual({ order_num: 'A' })
  })
})

describe('shipments slice — patchShipmentShadow reducer', () => {
  it('shallow-merges into pegasus_shadow on the matching shipment', () => {
    const store = makeStore({
      shipmentList: [
        { order_num: 1, pegasus_shadow: { a: 1, b: 2 } },
        { order_num: 2, pegasus_shadow: { a: 9 } },
      ],
    })
    store.dispatch(patchShipmentShadow({ order_num: 1, b: 22, c: 3 }))
    const list = store.getState().shipments.shipmentList
    expect(list[0].pegasus_shadow).toEqual({ a: 1, b: 22, c: 3, order_num: 1 })
    expect(list[1].pegasus_shadow).toEqual({ a: 9 })
  })

  it('calls API.patchShipmentShadow with the dto', () => {
    const store = makeStore({
      shipmentList: [{ order_num: 1, pegasus_shadow: {} }],
    })
    const dto = { order_num: 1, foo: 'bar' }
    store.dispatch(patchShipmentShadow(dto))
    expect(mockedAPI.patchShipmentShadow).toHaveBeenCalledWith(dto)
  })

  it('leaves the list alone when shipment lacks pegasus_shadow', () => {
    const store = makeStore({ shipmentList: [{ order_num: 1 }] })
    store.dispatch(patchShipmentShadow({ order_num: 1, foo: 'bar' }))
    expect(store.getState().shipments.shipmentList[0]).toEqual({ order_num: 1 })
  })

  it('handles unknown order_num gracefully', () => {
    const store = makeStore({ shipmentList: [{ order_num: 1, pegasus_shadow: {} }] })
    expect(() => store.dispatch(patchShipmentShadow({ order_num: 999 }))).not.toThrow()
    expect(mockedAPI.patchShipmentShadow).toHaveBeenCalledTimes(1)
  })
})

describe('shipments thunk — fetchShipments', () => {
  it('dispatches start then success and stores the list', async () => {
    const list = [{ order_num: 'X' }]
    mockedAPI.fetchShipments.mockResolvedValueOnce(list)
    const store = makeStore()
    const query = { searchTerm: 'X', filters: {}, sortBy: {} }
    await store.dispatch(fetchShipments(query) as any)
    expect(mockedAPI.fetchShipments).toHaveBeenCalledWith(query)
    expect(store.getState().shipments.loading).toBe(false)
    expect(store.getState().shipments.shipmentList).toEqual(list)
  })

  it('flips loading=true between start and success', async () => {
    let observed = false
    mockedAPI.fetchShipments.mockImplementationOnce(async () => {
      // Capture the in-flight loading state at the moment the API resolves.
      observed = store.getState().shipments.loading
      return []
    })
    const store = makeStore()
    await store.dispatch(fetchShipments({}) as any)
    expect(observed).toBe(true)
  })

  it('handles empty result list', async () => {
    mockedAPI.fetchShipments.mockResolvedValueOnce([])
    const store = makeStore({ shipmentList: [{ order_num: 'X' }] })
    await store.dispatch(fetchShipments({}) as any)
    expect(store.getState().shipments.shipmentList).toEqual([])
  })

  it('captures error message on rejection', async () => {
    const errSpy = silenceConsoleError()
    mockedAPI.fetchShipments.mockRejectedValueOnce(new Error('network down'))
    const store = makeStore()
    await store.dispatch(fetchShipments({}) as any)
    expect(store.getState().shipments.loading).toBe(false)
    expect(store.getState().shipments.error).toBe('network down')
    errSpy.mockRestore()
  })
})

describe('shipments thunk — selectShipment', () => {
  it('clears selection when given falsy payload (no API call)', async () => {
    const store = makeStore({ selectedShipment: { order_num: 1 } })
    await store.dispatch(selectShipment(null) as any)
    expect(store.getState().shipments.selectedShipment).toBeNull()
    expect(mockedAPI.fetchShipments).not.toHaveBeenCalled()
  })

  it('fetches by order_num and stores the first match', async () => {
    const ship = { order_num: 7, label: 'one' }
    mockedAPI.fetchShipments.mockResolvedValueOnce([ship, { order_num: 8 }])
    const store = makeStore()
    await store.dispatch(selectShipment({ order_num: 7 }) as any)
    expect(mockedAPI.fetchShipments).toHaveBeenCalledWith({ searchTerm: '7' })
    expect(store.getState().shipments.selectedShipment).toEqual(ship)
    expect(store.getState().shipments.loadingSelectedShipment).toBe(false)
  })

  it('captures error and clears loadingSelectedShipment on rejection', async () => {
    const errSpy = silenceConsoleError()
    mockedAPI.fetchShipments.mockRejectedValueOnce(new Error('boom'))
    const store = makeStore()
    await store.dispatch(selectShipment({ order_num: 1 }) as any)
    expect(store.getState().shipments.error).toBe('boom')
    expect(store.getState().shipments.loadingSelectedShipment).toBe(false)
    errSpy.mockRestore()
  })
})

describe('shipments thunk — loadDefaultFilter', () => {
  it('dispatches changeShipmentQuery with parsed query when API returns a record', async () => {
    mockedAPI.fetchShipmentDefaultFilterForUser.mockResolvedValueOnce({
      query: JSON.stringify({ searchTerm: 'pre-set', filters: { foo: 1 } }),
    })
    const store = makeStore()
    await store.dispatch(loadDefaultFilter('user-1') as any)
    expect(store.getState().shipments.query.searchTerm).toBe('pre-set')
    expect(store.getState().shipments.query.filters).toEqual({ foo: 1 })
  })

  it('does nothing when API returns falsy', async () => {
    mockedAPI.fetchShipmentDefaultFilterForUser.mockResolvedValueOnce(null)
    const store = makeStore({ query: { searchTerm: 'orig', filters: {}, sortBy: {} } })
    await store.dispatch(loadDefaultFilter('user-1') as any)
    expect(store.getState().shipments.query.searchTerm).toBe('orig')
  })

  it('surfaces API rejection via notifyError (logs to console)', async () => {
    const errSpy = silenceConsoleError()
    mockedAPI.fetchShipmentDefaultFilterForUser.mockRejectedValueOnce(new Error('x'))
    const store = makeStore({ query: { searchTerm: 'orig', filters: {}, sortBy: {} } })
    await expect(store.dispatch(loadDefaultFilter('user-1') as any)).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
    expect(mockedNotifyError).toHaveBeenCalledTimes(1)
    expect(mockedNotifyError).toHaveBeenCalledWith('x')
    // No dispatch — query unchanged.
    expect(store.getState().shipments.query.searchTerm).toBe('orig')
    errSpy.mockRestore()
  })

  it('falls back to a default message when the rejection has no message', async () => {
    const errSpy = silenceConsoleError()
    mockedAPI.fetchShipmentDefaultFilterForUser.mockRejectedValueOnce({})
    const store = makeStore()
    await store.dispatch(loadDefaultFilter('user-1') as any)
    expect(mockedNotifyError).toHaveBeenCalledWith('Failed to load default filter')
    errSpy.mockRestore()
  })

  it('does not dispatch and notifies on malformed JSON', async () => {
    const errSpy = silenceConsoleError()
    mockedAPI.fetchShipmentDefaultFilterForUser.mockResolvedValueOnce({ query: 'not valid json' })
    const store = makeStore({ query: { searchTerm: 'orig', filters: {}, sortBy: {} } })
    await store.dispatch(loadDefaultFilter('user-1') as any)
    expect(store.getState().shipments.query.searchTerm).toBe('orig')
    expect(mockedNotifyError).toHaveBeenCalledTimes(1)
    expect(mockedNotifyError).toHaveBeenCalledWith(
      'Saved filter is malformed and could not be applied',
    )
    errSpy.mockRestore()
  })

  it('does not dispatch and notifies when parsed query is not an object (null)', async () => {
    const errSpy = silenceConsoleError()
    mockedAPI.fetchShipmentDefaultFilterForUser.mockResolvedValueOnce({ query: 'null' })
    const store = makeStore({ query: { searchTerm: 'orig', filters: {}, sortBy: {} } })
    await store.dispatch(loadDefaultFilter('user-1') as any)
    expect(store.getState().shipments.query.searchTerm).toBe('orig')
    expect(mockedNotifyError).toHaveBeenCalledTimes(1)
    expect(mockedNotifyError).toHaveBeenCalledWith(
      'Saved filter is malformed and could not be applied',
    )
    errSpy.mockRestore()
  })
})

describe('shipments thunk — deleteShipmentFilter', () => {
  it('dispatches changeShipmentQuery with parsed query from response', async () => {
    mockedAPI.deleteShipmentFilter.mockResolvedValueOnce({
      query: JSON.stringify({ searchTerm: 'after-delete' }),
    })
    const store = makeStore()
    await store.dispatch(deleteShipmentFilter(123) as any)
    expect(mockedAPI.deleteShipmentFilter).toHaveBeenCalledWith(123)
    expect(store.getState().shipments.query.searchTerm).toBe('after-delete')
  })

  it('does nothing when API returns falsy', async () => {
    mockedAPI.deleteShipmentFilter.mockResolvedValueOnce(undefined)
    const store = makeStore({ query: { searchTerm: 'orig', filters: {}, sortBy: {} } })
    await store.dispatch(deleteShipmentFilter(1) as any)
    expect(store.getState().shipments.query.searchTerm).toBe('orig')
  })

  it('surfaces API rejection via notifyError', async () => {
    const errSpy = silenceConsoleError()
    mockedAPI.deleteShipmentFilter.mockRejectedValueOnce(new Error('y'))
    const store = makeStore({ query: { searchTerm: 'orig', filters: {}, sortBy: {} } })
    await expect(store.dispatch(deleteShipmentFilter(1) as any)).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
    expect(mockedNotifyError).toHaveBeenCalledTimes(1)
    expect(mockedNotifyError).toHaveBeenCalledWith('y')
    expect(store.getState().shipments.query.searchTerm).toBe('orig')
    errSpy.mockRestore()
  })

  it('falls back to a default message when the rejection has no message', async () => {
    const errSpy = silenceConsoleError()
    mockedAPI.deleteShipmentFilter.mockRejectedValueOnce({})
    const store = makeStore()
    await store.dispatch(deleteShipmentFilter(1) as any)
    expect(mockedNotifyError).toHaveBeenCalledWith('Failed to delete filter')
    errSpy.mockRestore()
  })

  it('does not dispatch and notifies on malformed JSON', async () => {
    const errSpy = silenceConsoleError()
    mockedAPI.deleteShipmentFilter.mockResolvedValueOnce({ query: '{not json' })
    const store = makeStore({ query: { searchTerm: 'orig', filters: {}, sortBy: {} } })
    await store.dispatch(deleteShipmentFilter(1) as any)
    expect(store.getState().shipments.query.searchTerm).toBe('orig')
    expect(mockedNotifyError).toHaveBeenCalledWith(
      'Saved filter is malformed and could not be applied',
    )
    errSpy.mockRestore()
  })

  it('does not dispatch and notifies when parsed query is not an object (null)', async () => {
    const errSpy = silenceConsoleError()
    mockedAPI.deleteShipmentFilter.mockResolvedValueOnce({ query: 'null' })
    const store = makeStore({ query: { searchTerm: 'orig', filters: {}, sortBy: {} } })
    await store.dispatch(deleteShipmentFilter(1) as any)
    expect(store.getState().shipments.query.searchTerm).toBe('orig')
    expect(mockedNotifyError).toHaveBeenCalledWith(
      'Saved filter is malformed and could not be applied',
    )
    errSpy.mockRestore()
  })
})
