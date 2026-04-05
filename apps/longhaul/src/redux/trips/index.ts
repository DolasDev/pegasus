import { API } from '../../utils/api';
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { AppDispatch } from '../store';

export interface TripsState {
  loading: boolean;
  selectedTrip: any;
  tripList: any[];
  query: any;
  error: boolean | string;
}

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
  } as TripsState,
  reducers: {
    selectTrip(state, action: PayloadAction<any>) {
      const trip = action.payload;
      state.selectedTrip = trip;
    },
    fetchTripsStart(state, _action: PayloadAction<void>) {
      state.loading = true;
    },
    fetchTripsSuccess(state, action: PayloadAction<any[]>) {
      state.tripList = action.payload;
      state.loading = false;
    },
    fetchTripsFailure(state, action: PayloadAction<string>) {
      state.loading = false;
      state.error = action.payload;
    },
    changeTripsQuery(state, action: PayloadAction<any>) {
      state.query = {
        ...state.query,
        ...action.payload,
      };
    },
    editTrip(state, action: PayloadAction<any>) {
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

export const fetchTrips = (query: any) => async (dispatch: AppDispatch) => {
  const { fetchTripsStart, fetchTripsFailure, fetchTripsSuccess } = tripsSlice.actions;
  try {
    dispatch(fetchTripsStart());
    const trips = await API.fetchTrips(query);
    dispatch(fetchTripsSuccess(trips));
  } catch (e: any) {
    console.error(e);
    dispatch(fetchTripsFailure(e.message));
  }
};

export const updateActivityForTrip = (activityId: any, activity: any) => async (_dispatch: AppDispatch) => {
  try {
    await API.saveActivity(activityId, activity);
  } catch (e: any) {
    console.error(e, 'failed to save activity');
  }
};
