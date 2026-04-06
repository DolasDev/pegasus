import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { API } from '../../utils/api'
import type { AppDispatch } from '../store'

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
  error: boolean | string
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
    error: false,
  } as ShipmentsState,
  reducers: {
    saveShipmentCoverage(state, action: PayloadAction<any>) {
      const shipmentCoverageDto = action.payload
      const shipmentIndexInList = findWithAttr(
        state.shipmentList,
        'order_num',
        shipmentCoverageDto.order_num,
      )
      if (state.shipmentList[shipmentIndexInList]?.packing_coverage) {
        state.shipmentList[shipmentIndexInList].packing_coverage = shipmentCoverageDto
      }
      API.saveShipmentCoverage(shipmentCoverageDto)
    },

    patchShipmentShadow(state, action: PayloadAction<any>) {
      const shipmentShadowDto = action.payload
      const shipmentIndexInList = findWithAttr(
        state.shipmentList,
        'order_num',
        shipmentShadowDto.order_num,
      )
      if (state.shipmentList[shipmentIndexInList]?.pegasus_shadow) {
        state.shipmentList[shipmentIndexInList].pegasus_shadow = {
          ...state.shipmentList[shipmentIndexInList].pegasus_shadow,
          ...shipmentShadowDto,
        }
      }
      API.patchShipmentShadow(shipmentShadowDto)
    },

    changeShipmentQuery(state, action: PayloadAction<any>) {
      state.query = {
        ...state.query,
        ...action.payload,
      }
    },

    resetToDefaultShipmentQuery(state) {
      state.query = structuredClone(DEFAULT_QUERY)
    },

    fetchShipmentsStart(state, _action: PayloadAction<void>) {
      state.loading = true
    },
    fetchShipmentsSuccess(state, action: PayloadAction<any[]>) {
      state.shipmentList = action.payload
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
  saveShipmentCoverage,
  patchShipmentShadow,
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
  } else {
    try {
      dispatch(fetchShipmentStart())
      const shipment = await API.fetchShipments({ searchTerm: String(selectedShipment.order_num) })
      dispatch(fetchShipmentSuccess(shipment[0]))
    } catch (e: any) {
      console.error(`Error fetching shipment`, e)
      dispatch(fetchShipmentFailure(e.message))
    }
  }
}

export const loadDefaultFilter = (_userCode: any) => async (dispatch: AppDispatch, _state: any) => {
  try {
    const response = await API.fetchShipmentDefaultFilterForUser()
    if (response) {
      dispatch(changeShipmentQuery(JSON.parse(response.query)))
    }
  } catch (e: any) {
    console.error(e)
  }
}

export const deleteShipmentFilter = (id: any) => async (dispatch: AppDispatch) => {
  try {
    const response = await API.deleteShipmentFilter(id)
    if (response) {
      dispatch(changeShipmentQuery(JSON.parse(response.query)))
    }
  } catch (e: any) {
    console.error(e)
  }
}

export default shipmentsSlice.reducer
