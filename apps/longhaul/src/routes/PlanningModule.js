import React, { useEffect } from 'react';
import { useLocation, useBlocker } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import qs from 'query-string';

import { SearchDashboard } from '../containers/Shipments';
import { PendingTrips } from '../containers/PendingTrips';
import { ShipmentDetail } from '../containers/ShipmentDetail';
import { initializeTripPage as resetPageAction } from 'src/redux/pending-trips';

export function PlanningModule() {
  const location = useLocation();
  const tripId = qs.parse(location.search).tripId;
  const { user: planner } = useSelector((state) => state.user);
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(resetPageAction(tripId, planner));
  }, [dispatch, tripId, planner.id, planner.code]);
  return (
    <>
      <div className="PlanningModule__container">
        <PromptWrapper />
        <div className="App__left-column">
          <SearchDashboard />
        </div>
        <div className="App__right-column">
          <PendingTrips />
        </div>
        <ShipmentDetail />
      </div>
    </>
  );
}

function PromptWrapper() {
  const { user: planner } = useSelector((state) => state.user);
  const tripSlice = useSelector((state) => state.tripPlanning);
  const shouldBlockNavigation = JSON.stringify(tripSlice.trip) !== JSON.stringify(tripSlice.unsavedTrip);
  const dispatch = useDispatch();
  function resetPage() {
    dispatch(resetPageAction(null, planner));
  }

  useBlocker(
    ({ currentLocation, nextLocation }) =>
      shouldBlockNavigation &&
      currentLocation.pathname !== nextLocation.pathname &&
      !window.confirm('You have unsaved changes, are you sure you want to leave?')
  );

  return <ResetWrapper resetPage={resetPage} />;
}


class ResetWrapper extends React.Component {
  componentWillUnmount() {
    this.props.resetPage();
  }
  render() {
    return this.props.children || null;
  }
}
