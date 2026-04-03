import React, { useEffect } from 'react';
import { withRouter, Prompt } from 'react-router';
import { useSelector, useDispatch } from 'react-redux';
import qs from 'query-string';
import isEqual from 'lodash/isEqual';

import { SearchDashboard } from '../containers/Shipments';
import { PendingTrips } from '../containers/PendingTrips';
import { ShipmentDetail } from '../containers/ShipmentDetail';
import { initializeTripPage as resetPageAction } from 'src/redux/pending-trips';

export const PlanningModule = withRouter((props) => {
  const tripId = qs.parse(props.location.search).tripId;
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
});

function PromptWrapper() {
  const { user: planner } = useSelector((state) => state.user);
  const tripSlice = useSelector((state) => state.tripPlanning);
  const shouldBlockNavigation = !isEqual(tripSlice.trip, tripSlice.unsavedTrip);
  const dispatch = useDispatch();
  function resetPage() {
    dispatch(resetPageAction(null, planner));
  }

  return <ResetWrapper resetPage={resetPage}><Prompt when={shouldBlockNavigation} message="You have unsaved changes, are you sure you want to leave?" /></ResetWrapper>;
}


class ResetWrapper extends React.Component {
  componentWillUnmount() {
    this.props.resetPage();
  }
  render() {
    return this.props.children;
  }
}