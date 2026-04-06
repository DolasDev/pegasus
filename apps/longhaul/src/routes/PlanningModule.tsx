import React, { useEffect } from 'react'
import { useLocation, useBlocker } from 'react-router-dom'
import { useSelector } from 'react-redux'
import qs from 'query-string'
import isEqual from 'lodash/isEqual'

import { SearchDashboard } from '../containers/Shipments'
import { PendingTrips } from '../containers/PendingTrips'
import { ShipmentDetail } from '../containers/ShipmentDetail'
import { initializeTripPage as resetPageAction } from 'src/redux/pending-trips'
import { useAppDispatch } from '../redux/hooks'
import type { RootState } from '../redux/store'

export function PlanningModule() {
  const location = useLocation()
  const tripId = qs.parse(location.search).tripId
  const { user: planner } = useSelector((state: RootState) => (state as any).user)
  const dispatch = useAppDispatch()

  useEffect(() => {
    dispatch(resetPageAction(tripId, planner) as any)
  }, [dispatch, tripId, planner.id, planner.code])

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
  )
}

function PromptWrapper() {
  const { user: planner } = useSelector((state: RootState) => (state as any).user)
  const tripSlice = useSelector((state: RootState) => (state as any).tripPlanning)
  const shouldBlockNavigation = !isEqual(tripSlice.trip, tripSlice.unsavedTrip)
  const dispatch = useAppDispatch()

  const blocker = useBlocker(shouldBlockNavigation)

  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('You have unsaved changes, are you sure you want to leave?')) {
        blocker.proceed()
      } else {
        blocker.reset()
      }
    }
  }, [blocker])

  useEffect(() => {
    return () => {
      dispatch(resetPageAction(null, planner) as any)
    }
  }, [dispatch, planner])

  return null
}
