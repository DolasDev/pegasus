import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { notifyError } from '../../components/Snackbar/notify'
import { API } from '../../utils/api'
import logger from '../../utils/logger'
import { coerceListPayload } from '../lib/coerce-list-payload'
import type { AppDispatch } from '../store'

export interface TripPlanningState {
  trip: any
  unsavedTrip: any
  shipmentToTrips: Record<string, any>
  selectedTripIndex?: any
  loading?: boolean
  error?: any
}

const BLANK_TRIP = {
  name: null,
  driver: null,
  shipments: [],
  status: {
    id: 1,
    status_id: 1,
    status: 'Pending',
  },
} as const

const initialState: TripPlanningState = {
  trip: { ...BLANK_TRIP },
  unsavedTrip: null,
  shipmentToTrips: {},
}

const tripPlanningSlice = createSlice({
  name: 'tripPlanning',
  initialState,
  reducers: {
    addShipmentToTrip(state, action: PayloadAction<any>) {
      const shipment = action.payload
      if (!state.shipmentToTrips[shipment.order_num]) {
        state.shipmentToTrips[shipment.order_num] = {}
      }

      if (!(state.selectedTripIndex in state.shipmentToTrips[shipment.order_num])) {
        state.trip.shipments.push(shipment)
        state.shipmentToTrips[shipment.order_num][state.selectedTripIndex] = state.trip.name ?? true
      }
    },
    removeShipmentFromTrip(state, action: PayloadAction<number>) {
      const shipmentIndexToRemove = action.payload
      const shipment = state.trip.shipments[shipmentIndexToRemove]
      if (!shipment) return
      if (state.shipmentToTrips[shipment.order_num]) {
        delete state.shipmentToTrips[shipment.order_num][state.selectedTripIndex]
      }
      state.trip.shipments.splice(shipmentIndexToRemove, 1)
    },
    editTrip(state, action: PayloadAction<any>) {
      const selectedTrip = state.trip
      state.trip = {
        ...selectedTrip,
        ...action.payload,
      }
    },
    removeActivity(state, action: PayloadAction<{ shipmentIndex: number; activityIndex: number }>) {
      const shipment = state.trip.shipments[action.payload.shipmentIndex]
      if (!shipment) return
      if (shipment.activities.length === 1) {
        if (state.shipmentToTrips[shipment.order_num]) {
          delete state.shipmentToTrips[shipment.order_num][state.selectedTripIndex]
        }
        state.trip.shipments.splice(action.payload.shipmentIndex, 1)
      } else {
        shipment.extraActivities ??= []
        shipment.extraActivities.push(shipment.activities[action.payload.activityIndex])
        shipment.activities.splice(action.payload.activityIndex, 1)
      }
    },

    editActivity(
      state,
      action: PayloadAction<{ shipmentIndex: number; activityIndex: number; partialActivity: any }>,
    ) {
      const shipmentIndex = action.payload.shipmentIndex
      const activityIndex = action.payload.activityIndex
      const partialActivity = action.payload.partialActivity
      const activityToUpdate = state.trip.shipments[shipmentIndex].activities[activityIndex]
      state.trip.shipments[shipmentIndex].activities[activityIndex] = {
        ...activityToUpdate,
        ...partialActivity,
      }
    },

    addActivity(
      state,
      action: PayloadAction<{ shipmentIndex: number; activity: any; activityIdx: number }>,
    ) {
      state.trip.shipments[action.payload.shipmentIndex].activities.push(action.payload.activity)
      state.trip.shipments[action.payload.shipmentIndex].activities.sort((a: any, b: any) =>
        a['activityType']['sequencePriority'] > b['activityType']['sequencePriority'] ? 1 : -1,
      )
      delete state.trip.shipments[action.payload.shipmentIndex].extraActivities[
        action.payload.activityIdx
      ]
    },
    swapOrder(state, action: PayloadAction<{ from: number; up: boolean }>) {
      const { from, up } = action.payload
      const shipments = state.trip.shipments
      if (from < 0 || from >= shipments.length) return
      const to = up ? from - 1 : from + 1
      if (to < 0 || to >= shipments.length) return
      shipments.splice(to, 0, shipments.splice(from, 1)[0])
    },
    saveTripRequest(state, _action: PayloadAction<void>) {
      state.loading = true
    },
    saveTripSuccess(state, action: PayloadAction<any>) {
      state.loading = false
      state.trip.id = action.payload.id
    },
    saveTripFailure(state, action: PayloadAction<any>) {
      state.loading = false
      state.error = action.payload
    },
    setTrip(state, action: PayloadAction<any>) {
      //state.shipmentToTrips = initialState.shipmentToTrips; --This appears to make state.shipmentToTrips immutable
      state.trip = action.payload
      state.trip.driver_id = action.payload.driver_id ? action.payload.driver_id : null
      state.unsavedTrip = action.payload
      state.shipmentToTrips = {}
      const shipments = coerceListPayload(action.payload.shipments)
      shipments.forEach((shipment: any) => {
        if (!state.shipmentToTrips[shipment.order_num]) {
          state.shipmentToTrips[shipment.order_num] = {}
        }
        if (!(state.selectedTripIndex in state.shipmentToTrips[shipment.order_num])) {
          state.shipmentToTrips[shipment.order_num][state.selectedTripIndex] =
            state.trip.name ?? true
        }
      })
    },
    setSelectedTripIndex(state, action: PayloadAction<number | undefined>) {
      state.selectedTripIndex = action.payload
    },
    createNewTrip(state) {
      state.trip = { ...BLANK_TRIP }
      state.unsavedTrip = null
      state.shipmentToTrips = {}
      state.selectedTripIndex = undefined
    },
    setError(state, action: PayloadAction<string>) {
      state.error = action.payload
    },
  },
})

export const {
  saveTripRequest,
  saveTripSuccess,
  saveTripFailure,
  swapOrder,
  addShipmentToTrip,
  editTrip,
  removeShipmentFromTrip,
  removeActivity,
  addActivity,
  setTrip,
  editActivity,
  setSelectedTripIndex,
  createNewTrip,
  setError,
} = tripPlanningSlice.actions

export const saveTrip = (trip: any) => async (dispatch: AppDispatch) => {
  dispatch(saveTripRequest())
  const savedTrip = await API.saveTrip(trip)
  dispatch(saveTripSuccess(savedTrip))
  dispatch(
    setTrip({
      ...savedTrip,
      ...trip,
    }),
  )
  return savedTrip.id
}

export const initializeTripPage = (tripId: any, user: any) => async (dispatch: AppDispatch) => {
  try {
    const createPendingTrip = ({ trip_title = 'Pending Trip' } = {}) => ({
      trip_title,
      driver: null,
      shipments: [],
      created_by_id: user.code,
      dispatcher: user,
      status: {
        id: 1,
        status_id: 1,
        status: 'Pending',
      },
    })

    let trip: any

    if (!tripId) {
      trip = createPendingTrip()
    } else {
      trip = await API.fetchTrip(tripId)
      trip.updated_by_id = user.code
    }

    dispatch(setTrip(trip))
  } catch (e: any) {
    const msg = `error initializing ${e?.message ?? 'unknown error'}`
    logger.error(e)
    dispatch(setError(msg))
    notifyError(msg)
  }
}

export const cancelTrip = (tripId: any, user: any) => async (dispatch: AppDispatch) => {
  try {
    await API.cancelTrip(tripId)
    dispatch(initializeTripPage(null, user) as any)
  } catch (e: any) {
    logger.error(e)
  }
}

export default tripPlanningSlice.reducer
