// ---------------------------------------------------------------------------
// Services (formerly Dispatch Activities) route module.
//
// Single column, and thinner than PlanningModule:
//   - ShipmentDetail IS mounted: selecting a service card selects that
//     activity's order, and the drawer opens exactly as it does on Planning;
//   - no PendingTrips  — deferred by request; there is nowhere to drag work
//                        into yet;
//   - no navigation blocker — PlanningModule prompts on unsaved trip edits,
//     and nothing here edits a trip.
// ---------------------------------------------------------------------------

import { ActivitiesDashboard } from '../containers/Activities'
import { ShipmentDetail } from '../containers/ShipmentDetail'

export function ActivitiesModule() {
  return (
    <div className="ActivitiesModule__container">
      <div className="App__left-column">
        <ActivitiesDashboard />
      </div>
      <ShipmentDetail />
    </div>
  )
}
