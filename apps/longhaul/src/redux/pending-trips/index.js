import { createSlice } from '@reduxjs/toolkit';
import { API } from '../../utils/api';
import logger from '../../utils/logger';


const initialState = {
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
    addShipmentToTrip(state, action) {
      const shipment = action.payload;
      if (!state.shipmentToTrips[shipment.order_num]) {
        state.shipmentToTrips[shipment.order_num] = {};
      }

      if (!state.shipmentToTrips[shipment.order_num][state.selectedTripIndex]) {
        state.trip.shipments.push(shipment);
        state.shipmentToTrips[shipment.order_num][state.selectedTripIndex] = state.trip.name;
      }
    },
    removeShipmentFromTrip(state, action) {
      const shipmentIndexToRemove = action.payload;
      const shipment = state.trip.shipments[shipmentIndexToRemove];
      if (state.shipmentToTrips[shipment.order_num]) {
        delete state.shipmentToTrips[shipment.order_num][state.selectedTripIndex];
      }
      state.trip.shipments.splice(action.payload, 1);
    },
    editTrip(state, action) {
      const selectedTrip = state.trip;
      state.trip = {
        ...selectedTrip,
        ...action.payload,
      };
    },
    removeActivity(state, action) {
      if ( state.trip.shipments[action.payload.shipmentIndex].activities.length === 1) {
        const shipment = state.trip.shipments[action.payload.shipmentIndex];
        delete state.shipmentToTrips[shipment.order_num][state.selectedTripIndex];
        state.trip.shipments.splice(action.payload.shipmentIndex, 1);
      } else {
        state.trip.shipments[action.payload.shipmentIndex].extraActivities.push(state.trip.shipments[action.payload.shipmentIndex].activities[action.payload.activityIndex])
        state.trip.shipments[action.payload.shipmentIndex].activities.splice(action.payload.activityIndex, 1);
      }
    }, 
    
    editActivity(state, action) {
      const shipmentIndex = action.payload.shipmentIndex
      const activityIndex = action.payload.activityIndex
      const partialActivity = action.payload.partialActivity
      const activityToUpdate = state.trip.shipments[shipmentIndex].activities[activityIndex]
      state.trip.shipments[shipmentIndex].activities[activityIndex] = {
        ...activityToUpdate,
        ...partialActivity
      }
    }, 
    
    addActivity(state, action) {
      state.trip.shipments[action.payload.shipmentIndex].activities
      .push(action.payload.activity);
      state.trip.shipments[action.payload.shipmentIndex].activities
      .sort((a, b) => a['activityType']['sequencePriority'] > b['activityType']['sequencePriority'] ? 1 : -1);
      delete state.trip.shipments[action.payload.shipmentIndex].extraActivities[action.payload.activityIdx]
    },
    swapOrder(state, action) {
      const { from, up } = action.payload;
      const to = up ? from - 1 : from + 1;
      const shipments = state.trip.shipments;
      shipments.splice(to, 0, shipments.splice(from, 1)[0]);
    },
    saveTripRequest(state, action) {
      state.loading = true;
    },
    saveTripSuccess(state, action) {
      state.loading = false;
      state.trip.id = action.payload.id;
    },
    saveTripFailure(state, action) {
      state.loading = false;
      state.error = action.payload;
    },
    setTrip(state, action) {
      //state.shipmentToTrips = initialState.shipmentToTrips; --This appears to make state.shipmentToTrips immutable 
      state.trip = action.payload;
      state.trip.driver_id = action.payload.driver_id ? action.payload.driver_id : null;
      state.unsavedTrip = action.payload;
      state.shipmentToTrips = {}
      action.payload.shipments.forEach((shipment) => {
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
  setSelectedTripIndex,
  editTrip,
  removeShipmentFromTrip,
  createNewTrip,
  removeActivity,
  addActivity,
  setTrip,
  resetPage,
  editActivity,
} = tripPlanningSlice.actions;

export const saveTrip = (trip) => async (dispatch) => {
  dispatch(saveTripRequest());
  const savedTrip = await API.saveTrip(trip);
  dispatch(saveTripSuccess(savedTrip));
  dispatch(setTrip({
    ...savedTrip,
    ...trip,
  }))
  return savedTrip.id;

};

export const initializeTripPage = (tripId, user) => async (dispatch) => {
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

    let trip;

    if (!tripId) {
      trip = createPendingTrip();
    } else {
      trip = await API.fetchTrip(tripId);
      trip.updated_by_id = user.code;
    }

    dispatch(setTrip(trip));
  } catch (e) {
    e.message = `error initilazing ${e.message}`;
    logger.error(e);
  }
};

export const cancelTrip = (tripId, user) => async (dispatch) => {
  try {
    await API.cancelTrip(tripId);
    dispatch(initializeTripPage(null, user));
  } catch (e) {
    logger.error(e);
  }
}

export default tripPlanningSlice.reducer;
