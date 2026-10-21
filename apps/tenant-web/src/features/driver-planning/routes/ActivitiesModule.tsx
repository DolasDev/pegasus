// ---------------------------------------------------------------------------
// Services (formerly Dispatch Activities) route module.
//
// Single column, and thinner than PlanningModule:
//   - ShipmentDetail IS mounted: selecting a service card selects that
//     activity's order, and the drawer opens exactly as it does on Planning;
//   - no PendingTrips  — deferred by request; there is nowhere to drag work
//                        into yet;
//   - leaving the screen clears the selection: the Trip page mounts the same
//     drawer off the same global `selectedShipment`. A click away already
//     closes it (outside-click), but browser Back would carry it over open;
//   - no navigation blocker — PlanningModule prompts on unsaved trip edits,
//     and nothing here edits a trip.
//
// The board waits for the user's saved default filter before it mounts. The
// board fetches as soon as it mounts, so mounting first would query the
// built-in week and then re-query the saved range. The default is applied
// once per session (`defaultSeeded`), so coming Back from a trip keeps the
// dispatcher's current filters. A failed default read falls back to the
// built-in query.
// ---------------------------------------------------------------------------

import { useEffect } from 'react'
import { useSelector } from 'react-redux'
import { useQuery } from '@tanstack/react-query'
import { defaultServicesFilterQueryOptions } from '@/api/queries/services-filters'
import { ActivitiesDashboard } from '../containers/Activities'
import { fromSavedQuery } from '../containers/Activities/services-filter-query'
import { useServicesReferenceOptions } from '../containers/Activities/use-services-reference-options'
import { ShipmentDetail } from '../containers/ShipmentDetail'
import { selectShipment } from '../redux/shipments'
import { seedActivityQuery } from '../redux/activities'
import { useAppDispatch } from '../redux/hooks'
import type { RootState } from '../redux/store'

export function ActivitiesModule() {
  const dispatch = useAppDispatch()
  useEffect(
    () => () => {
      dispatch(selectShipment(null) as any)
    },
    [dispatch],
  )

  const seeded = useSelector((state: RootState) => state.activities.defaultSeeded)
  const defaultFilter = useQuery({ ...defaultServicesFilterQueryOptions, enabled: !seeded })
  const refs = useServicesReferenceOptions()

  useEffect(() => {
    if (seeded || defaultFilter.isPending) return
    const saved = defaultFilter.data
    dispatch(seedActivityQuery(saved ? fromSavedQuery(saved.query, refs) : null))
  }, [seeded, defaultFilter.isPending, defaultFilter.data, refs, dispatch])

  return (
    <div className="ActivitiesModule__container">
      <div className="App__left-column">
        {seeded ? <ActivitiesDashboard /> : <div data-target="activities-seeding">Loading...</div>}
      </div>
      <ShipmentDetail />
    </div>
  )
}
