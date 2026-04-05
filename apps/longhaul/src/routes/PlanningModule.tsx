import React, { useEffect } from 'react';
import { withRouter, Prompt } from 'react-router';
import { useSelector } from 'react-redux';
import qs from 'query-string';
import isEqual from 'lodash/isEqual';

import { SearchDashboard } from '../containers/Shipments';
import { PendingTrips } from '../containers/PendingTrips';
import { ShipmentDetail } from '../containers/ShipmentDetail';
import { initializeTripPage as resetPageAction } from 'src/redux/pending-trips';
import { useAppDispatch } from '../redux/hooks';
import type { RootState } from '../redux/store';

export const PlanningModule = withRouter((props: any) => {
  const tripId = qs.parse(props.location.search).tripId;
  const { user: planner } = useSelector((state: RootState) => (state as any).user);
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(resetPageAction(tripId, planner) as any);
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
  const { user: planner } = useSelector((state: RootState) => (state as any).user);
  const tripSlice = useSelector((state: RootState) => (state as any).tripPlanning);
  const shouldBlockNavigation = !isEqual(tripSlice.trip, tripSlice.unsavedTrip);
  const dispatch = useAppDispatch();
  function resetPage() {
    dispatch(resetPageAction(null, planner) as any);
  }

  return <ResetWrapper resetPage={resetPage}><Prompt when={shouldBlockNavigation} message="You have unsaved changes, are you sure you want to leave?" /></ResetWrapper>;
}


interface ResetWrapperProps {
  resetPage: () => void;
  children?: React.ReactNode;
}

class ResetWrapper extends React.Component<ResetWrapperProps> {
  override componentWillUnmount() {
    this.props.resetPage();
  }
  override render() {
    return this.props.children;
  }
}
