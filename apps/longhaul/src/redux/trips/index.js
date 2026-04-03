import { API } from '../../utils/api';
import { createSlice } from '@reduxjs/toolkit';

const tripsSlice = createSlice({
  name: 'trips',
  initialState: {
    loading: false,
    selectedTrip: null,
    tripList: [],
    query: {
      searchTerm: '',
      filters: {
        TripStatus_id: [{value: 1, label: "Pending"}, {value: 2, label: "Accepted"}, {value: 3, label: "Offered"}, {value: 4, label: "In-Progress"}],
        internal_status: [{value: 'active', label:'yes'}],
      },
      sortBy: {value: 'planned_first_day' , order: 'desc'}
    },
    error: false,
  },
  reducers: {
    selectTrip(state, action) {
      const trip = action.payload;
      state.selectedTrip = trip;
    },
    fetchTripsStart(state, action) {
      state.loading = true;
    },
    fetchTripsSuccess(state, action) {
      state.tripList = action.payload;
      state.loading = false;
    },
    fetchTripsFailure(state, action) {
      state.loading = false;
      state.error = action.payload;
    },
    changeTripsQuery(state, action) {
      state.query = {
        ...state.query,
        ...action.payload,
      };
    },
    editTrip(state, action) {
      const selectedTrip = state.selectedTrip;
      state.selectedTrip = {
        ...selectedTrip,
        ...action.payload,
      };
    },
  },
});

export const { selectTrip, changeTripsQuery, editTrip } = tripsSlice.actions;

export default tripsSlice.reducer;

export const fetchTrips = (query) => async (dispatch) => {
  const { fetchTripsStart, fetchTripsFailure, fetchTripsSuccess } = tripsSlice.actions;
  try {
    dispatch(fetchTripsStart());
    const trips = await API.fetchTrips(query);
    dispatch(fetchTripsSuccess(trips));
  } catch (e) {
    console.error(e);
    dispatch(fetchTripsFailure(e.message));
  }
};

export const updateActivityForTrip = (activityId, activity) => async (dispatch) => {
  try {
    await API.saveActivity(activityId, activity);
  } catch (e) {
    console.error(e, 'failed to save activity');
  }
};
