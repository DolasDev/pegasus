import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { API } from "../../utils/api";
import type { AppDispatch } from '../store';

export interface CommonState {
  loading: boolean;
  driversList: any[];
  error: boolean | string;
  tripStatuses: any[];
  stateList: any[];
  zoneList: any[];
  plannersList: any[];
  dispatcherList: any[];
  filterOptions?: any;
}

const commonSlice = createSlice({
  name: "common",
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
      state.loading = true;
    },
    fetchDriversSuccess(state, action: PayloadAction<any[]>) {
      state.driversList = action.payload
        .map(({ driver_name, ...rest }: any) => ({
          driver_name: (driver_name || "").trim(),
          ...rest
        }))
        .sort((a: any, b: any) => b.driver_name - a.driver_name);
      state.loading = false;
    },
    fetchDriversFailure(state, action: PayloadAction<string>) {
      state.loading = false;
      state.error = action.payload;
    },
    fetchStatusesSuccess(state, action: PayloadAction<any[]>) {
      state.tripStatuses = action.payload;
    },
    fetchStatesSuccess(state, action: PayloadAction<any[]>) {
      state.stateList = action.payload;
    },
    fetchZoneSuccess(state, action: PayloadAction<any[]>) {
      state.zoneList = action.payload;
    },
    fetchPlannersSuccess(state, action: PayloadAction<any[]>) {
      state.plannersList = action.payload;
    },
    fetchDispatcherSuccess(state, action: PayloadAction<any[]>) {
      state.dispatcherList = action.payload;
    },
    fetchFilterOptionsSuccess(state, action: PayloadAction<any>) {
      state.filterOptions = action.payload;
    }
  }
});

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
} = commonSlice.actions;

export const fetchDrivers = () => async (dispatch: AppDispatch) => {
  try {
    dispatch(fetchDriversStart());
    const shipments = await API.fetchDrivers();
    dispatch(fetchDriversSuccess(shipments));
  } catch (e: any) {
    console.error(e);
    dispatch(fetchDriversFailure(e.message));
  }
};

export const fetchTripStatuses = () => async (dispatch: AppDispatch) => {
  try {
    const tripShipments = await API.fetchTripStatuses();
    dispatch(fetchStatusesSuccess(tripShipments))
  } catch (e: any) {
    console.error(e);
  }
}

export const fetchZones = () => async (dispatch: AppDispatch) => {
  try {
    const zones = await API.fetchZones();
    dispatch(fetchZoneSuccess(zones))
  } catch (e: any) {
    console.error(e);
  }
}

export const fetchFilterOptions = () => async (dispatch: AppDispatch) => {
  try {
    const options = await API.fetchFilterOptions();
    dispatch(fetchFilterOptionsSuccess(options))
  } catch (e: any) {
    console.error(e);
  }
}


export const fetchStates = () => async (dispatch: AppDispatch) => {
  try {
    const states = await API.fetchStates();
    dispatch(fetchStatesSuccess(states))
  } catch (e: any) {
    console.error(e);
  }
}

export const fetchPlanners = () => async (dispatch: AppDispatch) => {
  try {
    const planners = await API.fetchPlanners();
    dispatch(fetchPlannersSuccess(planners))
  } catch (e: any) {
    console.error(e);
  }
}

export const fetchDispatchers = () => async (dispatch: AppDispatch) => {
  try {
    const dispatchers = await API.fetchDispatchers();
    dispatch(fetchDispatcherSuccess(dispatchers))
  } catch (e: any) {
    console.error(e);
  }
}

export default commonSlice.reducer;
