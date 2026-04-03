import React, { useEffect } from 'react';
import {
  // BrowserRouter as Router,
  HashRouter as Router,
  Switch,
  Route,
  Redirect,
} from 'react-router-dom';
import { useDispatch } from 'react-redux';

import "./App.css";
import { Nav } from "./containers/Nav";
import { PlanningModule } from "./routes/PlanningModule";
import { TripsModule } from "./routes/TripsModule";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ShipmentModule } from "./routes/ShipmentModule";
import { Trip } from "./containers/Trip";
import { fetchDrivers, fetchTripStatuses, fetchStates, fetchZones, fetchPlanners, fetchDispatchers, fetchFilterOptions } from "./redux/common";
import { AppGuard } from './containers/AppGuard';

function App() {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch(fetchDrivers());
    dispatch(fetchTripStatuses());
    dispatch(fetchStates());
    dispatch(fetchFilterOptions())
    dispatch(fetchZones());
    dispatch(fetchPlanners());
    dispatch(fetchDispatchers());
  }, [dispatch]);
  return (
    <Router
      getUserConfirmation={(message, callback) => {
        const allowTransition = window.confirm(message);
        callback(allowTransition);
      }}  
    >
      <ErrorBoundary>
        <div className="App">
          <Nav />
          <ErrorBoundary>
          <div className="App-inner-container">
            <AppGuard>
              <Switch>
                <Route exact path={['/', '/planning']}>
                  <PlanningModule />
                </Route>
                <Route path={['/trips']}>
                  <TripsModule />
                </Route>
                <Route path="/shipments">
                  <ShipmentModule />
                </Route>
                <Route exact path="/trip/:tripId">
                  <Trip />
                </Route>
                <Redirect to="/trips" />
              </Switch>
            </AppGuard>
          </div>
          </ErrorBoundary>
        </div>
      </ErrorBoundary>
    </Router>
  );
}

export default App;
