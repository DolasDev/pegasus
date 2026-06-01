import { configureStore } from '@reduxjs/toolkit'

// reducers
import tripPlanningReducer from './trip-planning'
import shipmentReducer from './shipments'
import commonReducer from './common'
import tripReducer from './trips'
import userReducer from './user'
import versionReducer from './version'

// Re-export state types so they can be resolved by consumers of this module
export type { TripPlanningState } from './trip-planning'
export type { ShipmentsState } from './shipments'
export type { CommonState } from './common'
export type { TripsState } from './trips'

const reducer = {
  tripPlanning: tripPlanningReducer,
  shipments: shipmentReducer,
  common: commonReducer,
  trips: tripReducer,
  user: userReducer,
  version: versionReducer,
}

const store = configureStore({
  reducer,
  devTools: import.meta.env.DEV,
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export default store
