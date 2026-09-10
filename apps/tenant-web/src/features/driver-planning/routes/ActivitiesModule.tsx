// ---------------------------------------------------------------------------
// Dispatch Activities route module.
//
// Single column, and much thinner than PlanningModule, because everything that
// module carries exists to serve editing:
//   - no PendingTrips  — deferred by request; the board is a reading surface
//                        in v1, with nowhere to drag work into yet;
//   - no ShipmentDetail — the drawer is bound to a SELECTED shipment, and this
//                        board's unit is the activity;
//   - no navigation blocker — PlanningModule prompts on unsaved trip edits.
//     Nothing here mutates, so a prompt would only ever be a false alarm.
//
// When activities become editable, the blocker is what comes back first.
// ---------------------------------------------------------------------------

import { ActivitiesDashboard } from '../containers/Activities'

export function ActivitiesModule() {
  return (
    <div className="ActivitiesModule__container">
      <div className="App__left-column">
        <ActivitiesDashboard />
      </div>
    </div>
  )
}
