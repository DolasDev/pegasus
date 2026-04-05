import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { API } from '../../utils/api';
import logger from '../../utils/logger';
import type { AppDispatch } from '../store';


export interface TripPlanningState {
  trip: any;
  unsavedTrip: any;
  shipmentToTrips: Record<string, any>;
  selectedTripIndex?: any;
  loading?: boolean;
  error?: any;
}

const initialState: TripPlanningState = {
  trip: {
    name: null,
    driver: null,
    shipments: [],
    status:{
      id: 1,
      status_id:1,
      status:'Pending'
    },
  },
  unsavedTrip: null,
  shipmentToTrips: {},
};

const tripPlanningSlice = createSlice({
  name: 'tripPlanning',
  initialState,
  reducers: {
    addShipmentToTrip(state, action: PayloadAction<any>) {
      const shipment = action.payload;
      if (!state.shipmentToTrips[shipment.order_num]) {
        state.shipmentToTrips[shipment.order_num] = {};
      }

      if (!state.shipmentToTrips[shipment.order_num][state.selectedTripIndex]) {
        state.trip.shipments.push(shipment);
        state.shipmentToTrips[shipment.order_num][state.selectedTripIndex] = state.trip.name;
      }
    },
    removeShipmentFromTrip(state, action: PayloadAction<number>) {
      const shipmentIndexToRemove = action.payload;
      const shipment = state.trip.shipments[shipmentIndexToRemove];
      if (state.shipmentToTrips[shipment.order_num]) {
        delete state.shipmentToTrips[shipment.order_num][state.selectedTripIndex];
      }
      state.trip.shipments.splice(action.payload, 1);
    },
    editTrip(state, action: PayloadAction<any>) {
      const selectedTrip = state.trip;
      state.trip = {
        ...selectedTrip,
        ...action.payload,
      };
    },
    removeActivity(state, action: PayloadAction<{ shipmentIndex: number; activityIndex: number }>) {
      if ( state.trip.shipments[action.payload.shipmentIndex].activities.length === 1) {
        const shipment = state.trip.shipments[action.payload.shipmentIndex];
        delete state.shipmentToTrips[shipment.order_num][state.selectedTripIndex];
        state.trip.shipments.splice(action.payload.shipmentIndex, 1);
      } else {
        state.trip.shipments[action.payload.shipmentIndex].extraActivities.push(state.trip.shipments[action.payload.shipmentIndex].activities[action.payload.activityIndex])
        state.trip.shipments[action.payload.shipmentIndex].activities.splice(action.payload.activityIndex, 1);
      }
    },

    editActivity(state, action: PayloadAction<{ shipmentIndex: number; activityIndex: number; partialActivity: any }>) {
      const shipmentIndex = action.payload.shipmentIndex
      const activityIndex = action.payload.activityIndex
      const partialActivity = action.payload.partialActivity
      const activityToUpdate = state.trip.shipments[shipmentIndex].activities[activityIndex]
      state.trip.shipments[shipmentIndex].activities[activityIndex] = {
        ...activityToUpdate,
        ...partialActivity
      }
    },

    addActivity(state, action: PayloadAction<{ shipmentIndex: number; activity: any; activityIdx: number }>) {
      state.trip.shipments[action.payload.shipmentIndex].activities
      .push(action.payload.activity);
      state.trip.shipments[action.payload.shipmentIndex].activities
      .sort((a: any, b: any) => a['activityType']['sequencePriority'] > b['activityType']['sequencePriority'] ? 1 : -1);
      delete state.trip.shipments[action.payload.shipmentIndex].extraActivities[action.payload.activityIdx]
    },
    swapOrder(state, action: PayloadAction<{ from: number; up: boolean }>) {
      const { from, up } = action.payload;
      const to = up ? from - 1 : from + 1;
      const shipments = state.trip.shipments;
      shipments.splice(to, 0, shipments.splice(from, 1)[0]);
    },
    saveTripRequest(state, _action: PayloadAction<void>) {
      state.loading = true;
    },
    saveTripSuccess(state, action: PayloadAction<any>) {
      state.loading = false;
      state.trip.id = action.payload.id;
    },
    saveTripFailure(state, action: PayloadAction<any>) {
      state.loading = false;
      state.error = action.payload;
    },
    setTrip(state, action: PayloadAction<any>) {
      //state.shipmentToTrips = initialState.shipmentToTrips; --This appears to make state.shipmentToTrips immutable
      state.trip = action.payload;
      state.trip.driver_id = action.payload.driver_id ? action.payload.driver_id : null;
      state.unsavedTrip = action.payload;
      state.shipmentToTrips = {}
      action.payload.shipments.forEach((shipment: any) => {
        if (!state.shipmentToTrips[shipment.order_num]) {
          state.shipmentToTrips[shipment.order_num] = {};
        }
        if (!state.shipmentToTrips[shipment.order_num][state.selectedTripIndex]) {
          state.shipmentToTrips[shipment.order_num][state.selectedTripIndex] = state.trip.name;
        }
      });
    },
  },
});

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
} = tripPlanningSlice.actions;

// These actions are referenced in imports but not defined in reducers.
// Export them as aliases to maintain compatibility.
export const setSelectedTripIndex = tripPlanningSlice.actions.editTrip;
export const createNewTrip = tripPlanningSlice.actions.editTrip;
export const resetPage = tripPlanningSlice.actions.editTrip;

export const saveTrip = (trip: any) => async (dispatch: AppDispatch) => {
  dispatch(saveTripRequest());
  const savedTrip = await API.saveTrip(trip);
  dispatch(saveTripSuccess(savedTrip));
  dispatch(setTrip({
    ...savedTrip,
    ...trip,
  }))
  return savedTrip.id;

};

export const initializeTripPage = (tripId: any, user: any) => async (dispatch: AppDispatch) => {
  try {
    const createPendingTrip = ({ trip_title = 'Pending Trip' } = {}) => ({
      trip_title,
      driver: null,
      shipments: [],
      created_by_id: user.code,
      dispatcher: user,
      status:{
        id: 1,
        status_id:1,
        status:'Pending'
      }
    });

    let trip: any;

    if (!tripId) {
      trip = createPendingTrip();
    } else {
      trip = await API.fetchTrip(tripId);
      trip.updated_by_id = user.code;
    }

    dispatch(setTrip(trip));
  } catch (e: any) {
    e.message = `error initilazing ${e.message}`;
    logger.error(e);
  }
};

export const cancelTrip = (tripId: any, user: any) => async (dispatch: AppDispatch) => {
  try {
    await API.cancelTrip(tripId);
    dispatch(initializeTripPage(null, user) as any);
  } catch (e: any) {
    logger.error(e);
  }
}

export default tripPlanningSlice.reducer;
