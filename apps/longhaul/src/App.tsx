import React, { useEffect } from 'react';
import {
  // BrowserRouter as Router,
  HashRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import "./App.css";
import { Nav } from "./containers/Nav";
import { PlanningModule } from "./routes/PlanningModule";
import { TripsModule } from "./routes/TripsModule";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ShipmentModule } from "./routes/ShipmentModule";
import { Trip } from "./containers/Trip";
import { fetchDrivers, fetchTripStatuses, fetchStates, fetchZones, fetchPlanners, fetchDispatchers, fetchFilterOptions } from "./redux/common";
import { AppGuard } from './containers/AppGuard';
import { useAppDispatch } from './redux/hooks';

function App() {
  const dispatch = useAppDispatch();
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
    <Router>
      <ErrorBoundary>
        <div className="App">
          <Nav />
          <ErrorBoundary>
          <div className="App-inner-container">
            <AppGuard>
              <Routes>
                <Route path="/" element={<PlanningModule />} />
                <Route path="/planning" element={<PlanningModule />} />
                <Route path="/trips" element={<TripsModule />} />
                <Route path="/shipments" element={<ShipmentModule />} />
                <Route path="/trip/:tripId" element={<Trip />} />
                <Route path="*" element={<Navigate to="/trips" replace />} />
              </Routes>
            </AppGuard>
          </div>
          </ErrorBoundary>
        </div>
      </ErrorBoundary>
    </Router>
  );
}

export default App;
