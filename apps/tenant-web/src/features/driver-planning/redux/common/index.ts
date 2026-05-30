import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { API } from '../../utils/api'
import type { AppDispatch } from '../store'
import { coerceListPayload as asArray } from '../lib/coerce-list-payload'

export interface CommonState {
  loading: boolean
  driversList: any[]
  error: boolean | string
  tripStatuses: any[]
  stateList: any[]
  zoneList: any[]
  plannersList: any[]
  dispatcherList: any[]
  filterOptions?: any
}

const commonSlice = createSlice({
  name: 'common',
  initialState: {
    loading: false,
    driversList: [],
    error: false,
    tripStatuses: [],
    stateList: [],
    zoneList: [],
    plannersList: [],
    dispatcherList: [],
  } as CommonState,
  reducers: {
    fetchDriversStart(state, _action: PayloadAction<void>) {
      state.loading = true
    },
    fetchDriversSuccess(state, action: PayloadAction<any[]>) {
      // Defensive: the ported on-prem bridge can hand back null on some error
      // shapes; an undefined reference list crashes the dropdown containers
      // (StatusDropdown / StateDropdown / DriverTypeahead .map straight off it)
      // → app error boundary, which is what was making the Trips list flake.
      state.driversList = asArray(action.payload)
        .map(({ driver_name, ...rest }: any) => ({
          driver_name: (driver_name || '').trim(),
          ...rest,
        }))
        .sort((a: any, b: any) => b.driver_name - a.driver_name)
      state.loading = false
    },
    fetchDriversFailure(state, action: PayloadAction<string>) {
      state.loading = false
      state.error = action.payload
    },
    fetchStatusesSuccess(state, action: PayloadAction<any[]>) {
      state.tripStatuses = asArray(action.payload)
    },
    fetchStatesSuccess(state, action: PayloadAction<any[]>) {
      state.stateList = asArray(action.payload)
    },
    fetchZoneSuccess(state, action: PayloadAction<any[]>) {
      state.zoneList = asArray(action.payload)
    },
    fetchPlannersSuccess(state, action: PayloadAction<any[]>) {
      state.plannersList = asArray(action.payload)
    },
    fetchDispatcherSuccess(state, action: PayloadAction<any[]>) {
      state.dispatcherList = asArray(action.payload)
    },
    fetchFilterOptionsSuccess(state, action: PayloadAction<any>) {
      state.filterOptions = action.payload ?? {}
    },
  },
})

export const {
  fetchDriversStart,
  fetchDriversSuccess,
  fetchDriversFailure,
  fetchStatusesSuccess,
  fetchStatesSuccess,
  fetchZoneSuccess,
  fetchPlannersSuccess,
  fetchDispatcherSuccess,
  fetchFilterOptionsSuccess,
} = commonSlice.actions

// All reference-data thunks log their error AND re-throw so the AppGuard
// bootstrap loop can collect every failure and surface them together. Before,
// only fetchDrivers signalled failure (via the `error` slice) while the rest
// swallowed silently — so a single misleading "Failed to fetch drivers" toast
// hid the fact that zones/states/trip-statuses were all failing too.
export const fetchDrivers = () => async (dispatch: AppDispatch) => {
  try {
    dispatch(fetchDriversStart())
    const shipments = await API.fetchDrivers()
    dispatch(fetchDriversSuccess(shipments))
  } catch (e: any) {
    console.error(e)
    dispatch(fetchDriversFailure(e.message))
    throw e
  }
}

export const fetchTripStatuses = () => async (dispatch: AppDispatch) => {
  try {
    const tripShipments = await API.fetchTripStatuses()
    dispatch(fetchStatusesSuccess(tripShipments))
  } catch (e: any) {
    console.error(e)
    throw e
  }
}

export const fetchZones = () => async (dispatch: AppDispatch) => {
  try {
    const zones = await API.fetchZones()
    dispatch(fetchZoneSuccess(zones))
  } catch (e: any) {
    console.error(e)
    throw e
  }
}

export const fetchFilterOptions = () => async (dispatch: AppDispatch) => {
  try {
    const options = await API.fetchFilterOptions()
    dispatch(fetchFilterOptionsSuccess(options))
  } catch (e: any) {
    console.error(e)
    throw e
  }
}

export const fetchStates = () => async (dispatch: AppDispatch) => {
  try {
    const states = await API.fetchStates()
    dispatch(fetchStatesSuccess(states))
  } catch (e: any) {
    console.error(e)
    throw e
  }
}

export const fetchPlanners = () => async (dispatch: AppDispatch) => {
  try {
    const planners = await API.fetchPlanners()
    dispatch(fetchPlannersSuccess(planners))
  } catch (e: any) {
    console.error(e)
    throw e
  }
}

export const fetchDispatchers = () => async (dispatch: AppDispatch) => {
  try {
    const dispatchers = await API.fetchDispatchers()
    dispatch(fetchDispatcherSuccess(dispatchers))
  } catch (e: any) {
    console.error(e)
    throw e
  }
}

// Batched bootstrap thunk — one cloud request replaces the seven individual
// fetchDrivers/fetchTripStatuses/.../fetchFilterOptions calls AppGuard used to
// fan out at mount. The payload is unpacked into the SAME per-slice success
// reducers so no component changes are needed.
//
// Graceful degradation: when the tenant has no `longhaulClient` configured
// the server returns `dispatchers: []` and `filterOptions: { moveType: [] }`
// (the other five lookups still populate). That is by design — see the
// handler in apps/api/src/handlers/longhaul-cloud/reference-data.ts.
export const fetchReferenceData = () => async (dispatch: AppDispatch) => {
  try {
    const data = await API.fetchReferenceData()
    dispatch(fetchDriversSuccess(data.drivers))
    dispatch(fetchStatusesSuccess(data.tripStatuses))
    dispatch(fetchStatesSuccess(data.states))
    dispatch(fetchZoneSuccess(data.zones))
    dispatch(fetchPlannersSuccess(data.planners))
    dispatch(fetchDispatcherSuccess(data.dispatchers))
    dispatch(fetchFilterOptionsSuccess(data.filterOptions))
  } catch (e: any) {
    console.error(e)
    throw e
  }
}

export default commonSlice.reducer
