// ---------------------------------------------------------------------------
// Services (formerly Dispatch Activities) route module.
//
// Single column, and thinner than PlanningModule:
//   - ShipmentDetail IS mounted: selecting a service card selects that
//     activity's order, and the drawer opens exactly as it does on Planning;
//   - no PendingTrips  — deferred by request; there is nowhere to drag work
//                        into yet;
//   - leaving the screen clears the selection: the Trip page mounts the same
//     drawer off the same global `selectedShipment`, so a card's trip link
//     would otherwise land on the trip with the drawer still open;
//   - no navigation blocker — PlanningModule prompts on unsaved trip edits,
//     and nothing here edits a trip.
// ---------------------------------------------------------------------------

import { useEffect } from 'react'
import { ActivitiesDashboard } from '../containers/Activities'
import { ShipmentDetail } from '../containers/ShipmentDetail'
import { selectShipment } from '../redux/shipments'
import { useAppDispatch } from '../redux/hooks'

export function ActivitiesModule() {
  const dispatch = useAppDispatch()
  useEffect(
    () => () => {
      dispatch(selectShipment(null) as any)
    },
    [dispatch],
  )

  return (
    <div className="ActivitiesModule__container">
      <div className="App__left-column">
        <ActivitiesDashboard />
      </div>
      <ShipmentDetail />
    </div>
  )
}
