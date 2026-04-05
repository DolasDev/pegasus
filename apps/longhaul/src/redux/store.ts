import { configureStore } from "@reduxjs/toolkit";

// middleware
import logger from "redux-logger";

// reducers
import pendingTripsReducer from "./pending-trips";
import shipmentReducer from "./shipments";
import commonReducer from "./common";
import tripReducer from "./trips";
import navReducer from "./nav";
import userReducer from './user';
import versionReducer from './version'

// Re-export state types so they can be resolved by consumers of this module
export type { TripPlanningState } from "./pending-trips";
export type { ShipmentsState } from "./shipments";
export type { CommonState } from "./common";
export type { TripsState } from "./trips";
export type { NavState } from "./nav";

const reducer = {
  tripPlanning: pendingTripsReducer,
  shipments: shipmentReducer,
  common: commonReducer,
  trips: tripReducer,
  nav: navReducer,
  user: userReducer,
  version: versionReducer,
};

const store = configureStore({
  reducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(logger as any),
  devTools: process.env.NODE_ENV !== "production"
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
