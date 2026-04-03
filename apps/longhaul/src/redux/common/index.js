import { createSlice } from "@reduxjs/toolkit";
import { API } from "../../utils/api";

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
  },
  reducers: {
    fetchDriversStart(state, action) {
      state.loading = true;
    },
    fetchDriversSuccess(state, action) {
      state.driversList = action.payload
        .map(({ driver_name, ...rest }) => ({
          driver_name: (driver_name || "").trim(),
          ...rest
        }))
        .sort((a, b) => b.driver_name - a.driver_name);
      state.loading = false;
    },
    fetchDriversFailure(state, action) {
      state.loading = false;
      state.error = action.payload;
    },
    fetchStatusesSuccess(state, action) {
      state.tripStatuses = action.payload;
    },
    fetchStatesSuccess(state, action) {
      state.stateList = action.payload;
    },
    fetchZoneSuccess(state, action) {
      state.zoneList = action.payload;
    },
    fetchPlannersSuccess(state, action) {
      state.plannersList = action.payload;
    },
    fetchDispatcherSuccess(state, action) {
      state.dispatcherList = action.payload;
    },
    fetchFilterOptionsSuccess(state, action) {
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

export const fetchDrivers = () => async dispatch => {
  try {
    dispatch(fetchDriversStart());
    const shipments = await API.fetchDrivers();
    dispatch(fetchDriversSuccess(shipments));
  } catch (e) {
    console.error(e);
    dispatch(fetchDriversFailure(e.message));
  }
};

export const fetchTripStatuses = () => async dispatch => {
  try {
    const tripShipments = await API.fetchTripStatuses();
    dispatch(fetchStatusesSuccess(tripShipments))
  } catch (e) {
    console.error(e);
  }
}

export const fetchZones = () => async dispatch => {
  try {
    const zones = await API.fetchZones();
    dispatch(fetchZoneSuccess(zones))
  } catch (e) {
    console.error(e);
  }
}

export const fetchFilterOptions = () => async dispatch => {
  try {
    const options = await API.fetchFilterOptions();
    dispatch(fetchFilterOptionsSuccess(options))
  } catch (e) {
    console.error(e);
  }
}


export const fetchStates = () => async dispatch => {
  try {
    const states = await API.fetchStates();
    dispatch(fetchStatesSuccess(states))
  } catch (e) {
    console.error(e);
  }
}

export const fetchPlanners = () => async dispatch => {
  try {
    const planners = await API.fetchPlanners();
    dispatch(fetchPlannersSuccess(planners))
  } catch (e) {
    console.error(e);
  }
}

export const fetchDispatchers = () => async dispatch => {
  try {
    const dispatchers = await API.fetchDispatchers();
    dispatch(fetchDispatcherSuccess(dispatchers))
  } catch (e) {
    console.error(e);
  }
}

export default commonSlice.reducer;
