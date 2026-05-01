import React from 'react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import { render } from '@testing-library/react'

// Build a tiny mini-store using minimal slice-shaped reducers so we don't need
// to pull in real reducers (which import API/etc.). The reducer just merges
// dispatched payloads under the slice name.
type AnyState = Record<string, any>

const passthroughReducer =
  (initial: AnyState) =>
  (state: AnyState | undefined = initial, action: any): AnyState => {
    if (action.type && typeof action.type === 'string' && action.type.startsWith('__set/')) {
      // Allow test code to push state directly: { type: '__set/<slice>', payload }
      const slice = action.type.slice('__set/'.length)
      if (slice === '__root__') return { ...state, ...action.payload }
      return { ...state, ...action.payload }
    }
    return state
  }

export const DEFAULT_QUERY: any = {
  searchTerm: '',
  filters: {
    Is_Trip_Planning: true,
    load_date: ['2026-01-01', '2026-12-31'],
    assigned: [{ label: 'No', value: 'No' }],
  },
  sortBy: {},
}

export interface MakeStoreOptions {
  shipments?: Partial<{
    loading: boolean
    selectedShipment: any
    shipmentList: any[]
    query: any
    error: any
    haulModes: any[]
    pegasus_shadow: any
    loadingSelectedShipment: boolean
  }>
  common?: Partial<{
    stateList: any[]
    zoneList: any[]
    tripStatuses: any[]
    dispatcherList: any[]
    driversList: any[]
    plannersList: any[]
    filterOptions: any
  }>
  user?: any
  tripPlanning?: any
  trips?: any
  nav?: any
  version?: any
}

export function makeStore(opts: MakeStoreOptions = {}) {
  const shipments = {
    loading: false,
    loadingSelectedShipment: false,
    selectedShipment: null,
    shipmentList: [],
    query: DEFAULT_QUERY,
    haulModes: [],
    pegasus_shadow: {},
    error: false,
    ...(opts.shipments || {}),
  }
  const common = {
    loading: false,
    driversList: [],
    error: false,
    tripStatuses: [],
    stateList: [],
    zoneList: [],
    plannersList: [],
    dispatcherList: [],
    filterOptions: { moveType: [] },
    ...(opts.common || {}),
  }
  const user = opts.user ?? { user: { code: 'TST', first_name: 'Test', last_name: 'User' } }
  const tripPlanning = opts.tripPlanning ?? { shipmentToTrips: {} }
  const trips = opts.trips ?? { tripsList: [] }
  const nav = opts.nav ?? {}
  const version = opts.version ?? { release_channel: 'stable' }

  return configureStore({
    reducer: {
      shipments: passthroughReducer(shipments),
      common: passthroughReducer(common),
      user: passthroughReducer(user),
      tripPlanning: passthroughReducer(tripPlanning),
      trips: passthroughReducer(trips),
      nav: passthroughReducer(nav),
      version: passthroughReducer(version),
    },
    devTools: false,
  })
}

export function renderWithStore(ui: React.ReactElement, opts: MakeStoreOptions = {}) {
  const store = makeStore(opts)
  const dispatched: any[] = []
  const origDispatch = store.dispatch
  ;(store as any).dispatch = ((action: any) => {
    dispatched.push(action)
    if (typeof action === 'function') {
      // thunk: invoke with our spy dispatch + getState
      try {
        return action(store.dispatch, store.getState)
      } catch {
        return undefined
      }
    }
    return origDispatch(action)
  }) as any
  const utils = render(<Provider store={store}>{ui}</Provider>)
  return { ...utils, store, dispatched }
}
