import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { API } from '../../utils/api'
import type { AppDispatch } from '../store'
import { coerceListPayload } from '../lib/coerce-list-payload'
import { notifyError } from '../../components/Snackbar/notify'

const getDateOffset = (offsetDays: number): string => {
  const today = new Date()
  today.setDate(today.getDate() + offsetDays)
  const dd = String(today.getDate()).padStart(2, '0')
  const mm = String(today.getMonth() + 1).padStart(2, '0') //January is 0!
  const yyyy = today.getFullYear()
  const offsetDate = yyyy + '-' + mm + '-' + dd
  return offsetDate
}

const DEFAULT_QUERY: any = {
  searchTerm: '',
  filters: {
    Is_Trip_Planning: true,
    load_date: [getDateOffset(-30), getDateOffset(30)],
    assigned: [{ label: 'No', value: 'No' }],
  },
  sortBy: {},
}

export interface ShipmentsState {
  loading: boolean
  loadingSelectedShipment: boolean
  selectedShipment: any
  shipmentList: any[]
  query: any
  haulModes: any[]
  pegasus_shadow: any
  error: string | null
}

const shipmentsSlice = createSlice({
  name: 'shipments',
  initialState: {
    loading: false,
    loadingSelectedShipment: false,
    selectedShipment: null,
    shipmentList: [],
    query: structuredClone(DEFAULT_QUERY),
    haulModes: [], // populates haulModes filter options
    pegasus_shadow: {},
    error: null,
  } as ShipmentsState,
  reducers: {
    // Pure apply-reducer driven by the saveShipmentCoverage thunk. Records the
    // dto on the matched shipment whether or not it had a prior packing_coverage
    // — a previous truthiness guard silently dropped first-time updates.
    applyShipmentCoverage(state, action: PayloadAction<any>) {
      const dto = action.payload
      const shipmentIndexInList = findWithAttr(state.shipmentList, 'order_num', dto.order_num)
      if (shipmentIndexInList !== -1) {
        state.shipmentList[shipmentIndexInList].packing_coverage = dto
      }
    },

    saveShipmentCoverageFailure(state, action: PayloadAction<string>) {
      state.error = action.payload
    },

    // Pure apply-reducer driven by the patchShipmentShadow thunk. See
    // applyShipmentCoverage on why the truthiness guard was dropped.
    applyShipmentShadow(state, action: PayloadAction<any>) {
      const dto = action.payload
      const shipmentIndexInList = findWithAttr(state.shipmentList, 'order_num', dto.order_num)
      if (shipmentIndexInList !== -1) {
        state.shipmentList[shipmentIndexInList].pegasus_shadow = {
          ...state.shipmentList[shipmentIndexInList].pegasus_shadow,
          ...dto,
        }
      }
    },

    patchShipmentShadowFailure(state, action: PayloadAction<string>) {
      state.error = action.payload
    },

    changeShipmentQuery(state, action: PayloadAction<any>) {
      // Deep-merge `filters` so a partial `{ filters: { foo: 1 } }` payload
      // doesn't wipe the rest of the filter object. For an explicit wholesale
      // reset, use `resetToDefaultShipmentQuery`.
      const payload = action.payload ?? {}
      state.query = {
        ...state.query,
        ...payload,
        filters: {
          ...state.query.filters,
          ...(payload.filters ?? {}),
        },
      }
    },

    resetToDefaultShipmentQuery(state) {
      state.query = structuredClone(DEFAULT_QUERY)
    },

    fetchShipmentsStart(state, _action: PayloadAction<void>) {
      state.loading = true
    },
    fetchShipmentsSuccess(state, action: PayloadAction<any[]>) {
      // Defensive (see fetchTripsSuccess): coerceListPayload keeps shipmentList
      // an array so the SearchDashboard / ShipmentsTable `.map`s can't crash
      // the module.
      state.shipmentList = coerceListPayload(action.payload)
      state.loading = false
    },
    fetchShipmentsFailure(state, action: PayloadAction<string>) {
      state.loading = false
      state.error = action.payload
    },
    fetchShipmentStart(state, _action: PayloadAction<void>) {
      state.loadingSelectedShipment = true
    },
    fetchShipmentSuccess(state, action: PayloadAction<any>) {
      state.selectedShipment = action.payload
      state.loadingSelectedShipment = false
    },
    fetchShipmentFailure(state, action: PayloadAction<string>) {
      state.loadingSelectedShipment = false
      state.error = action.payload
    },
  },
})

export const {
  fetchShipmentsSuccess,
  fetchShipmentsFailure,
  fetchShipmentsStart,
  fetchShipmentSuccess,
  fetchShipmentFailure,
  fetchShipmentStart,
  changeShipmentQuery,
  applyShipmentCoverage,
  saveShipmentCoverageFailure,
  applyShipmentShadow,
  patchShipmentShadowFailure,
  resetToDefaultShipmentQuery,
} = shipmentsSlice.actions

function findWithAttr(array: any[], attr: string, value: any): number {
  for (let i = 0; i < array.length; i += 1) {
    if (array[i][attr] === value) {
      return i
    }
  }
  return -1
}

export const fetchShipments = (query: any) => async (dispatch: AppDispatch) => {
  try {
    dispatch(fetchShipmentsStart())
    const shipments = await API.fetchShipments(query)
    dispatch(fetchShipmentsSuccess(shipments))
  } catch (e: any) {
    console.error(`Error fetching shipments`, e)
    dispatch(fetchShipmentsFailure(e.message))
  }
}

export const selectShipment = (selectedShipment: any) => async (dispatch: AppDispatch) => {
  if (!selectedShipment) {
    dispatch(fetchShipmentSuccess(null))
    return
  }
  const orderNum = String(selectedShipment.order_num)
  try {
    dispatch(fetchShipmentStart())
    // `fetchShipments({ searchTerm })` is a fuzzy substring match — searching
    // "7" also returns "70", "71", … — so result[0] can be the WRONG shipment.
    // Resolve the row whose order_num is an exact match, and treat "no exact
    // match" as not-found rather than silently loading a near-match.
    const results = await API.fetchShipments({ searchTerm: orderNum })
    const exact = (Array.isArray(results) ? results : []).find(
      (s: any) => String(s?.order_num) === orderNum,
    )
    if (exact) {
      dispatch(fetchShipmentSuccess(exact))
    } else {
      const msg = `Shipment ${orderNum} not found`
      dispatch(fetchShipmentFailure(msg))
      notifyError(msg)
    }
  } catch (e: any) {
    console.error(`Error fetching shipment`, e)
    const msg = e?.message ?? 'Failed to load shipment'
    dispatch(fetchShipmentFailure(msg))
    notifyError(msg)
  }
}

// Thunks: own the network call and error surfacing so reducers stay pure. The
// API fires unconditionally because the Coverage / shadow editors live in
// ShipmentDetail, where the user can be editing a shipment that isn't in the
// current dashboard list. The pure apply-reducers internally skip the state
// mutation when the dto's order_num isn't in shipmentList — that's the only
// gate needed.
export const saveShipmentCoverage = (dto: any) => async (dispatch: AppDispatch) => {
  dispatch(applyShipmentCoverage(dto))
  try {
    await API.saveShipmentCoverage(dto)
  } catch (e: any) {
    console.error(e)
    const msg = e?.message ?? 'Failed to save shipment coverage'
    dispatch(saveShipmentCoverageFailure(msg))
    notifyError(msg)
  }
}

export const patchShipmentShadow = (dto: any) => async (dispatch: AppDispatch) => {
  dispatch(applyShipmentShadow(dto))
  try {
    await API.patchShipmentShadow(dto)
  } catch (e: any) {
    console.error(e)
    const msg = e?.message ?? 'Failed to patch shipment shadow'
    dispatch(patchShipmentShadowFailure(msg))
    notifyError(msg)
  }
}

// Applies a saved-filter response from the API by parsing its `query` field
// and dispatching changeShipmentQuery. Reports malformed payloads to the user
// rather than silently no-op'ing (which previously masked broken filters).
const applySavedFilterResponse = (response: any, dispatch: AppDispatch): void => {
  if (!response) return
  let parsedQuery: any
  try {
    parsedQuery = JSON.parse(response.query)
  } catch (parseErr) {
    console.error('Malformed saved-filter query payload', parseErr)
    notifyError('Saved filter is malformed and could not be applied')
    return
  }
  if (!parsedQuery || typeof parsedQuery !== 'object') {
    console.error('Saved-filter query is not an object', parsedQuery)
    notifyError('Saved filter is malformed and could not be applied')
    return
  }
  dispatch(changeShipmentQuery(parsedQuery))
}

export const loadDefaultFilter = (_userCode: any) => async (dispatch: AppDispatch, _state: any) => {
  try {
    const response = await API.fetchShipmentDefaultFilterForUser()
    applySavedFilterResponse(response, dispatch)
  } catch (e: any) {
    console.error(e)
    notifyError(e?.message ?? 'Failed to load default filter')
  }
}

export const deleteShipmentFilter = (id: any) => async (dispatch: AppDispatch) => {
  try {
    const response = await API.deleteShipmentFilter(id)
    applySavedFilterResponse(response, dispatch)
  } catch (e: any) {
    console.error(e)
    notifyError(e?.message ?? 'Failed to delete filter')
  }
}

export default shipmentsSlice.reducer
