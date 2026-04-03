import { configureStore, getDefaultMiddleware } from "@reduxjs/toolkit";

// middlewhere
import logger from "redux-logger";

// reducers
import pendingTripsReducer from "./pending-trips";
import shipmentReducer from "./shipments";
import commonReducer from "./common";
import tripReducer from "./trips";
import navReducer from "./nav";
import userReducer from './user';
import versionReducer from './version'

const reducer = {
  tripPlanning: pendingTripsReducer,
  shipments: shipmentReducer,
  common: commonReducer,
  trips: tripReducer,
  nav: navReducer,
  user: userReducer,
  version: versionReducer,
};

const middleware = [...getDefaultMiddleware(), logger];

const store = configureStore({
  reducer,
  middleware,
  devTools: process.env.NODE_ENV !== "production"
});

export default store;
