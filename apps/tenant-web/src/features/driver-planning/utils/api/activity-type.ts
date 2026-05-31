// ---------------------------------------------------------------------------
// ActivityType — the nested shape the driver-planning UI reads off each
// activity. Mirrors the backend `ActivityType` interface
// (apps/api/src/lib/longhaul-shipment-enrich.ts), which in turn mirrors the
// legacy TypeORM entity `Longhaul_ActivityType`
// (repos/longhaul/server/modules/activityTypes/model/activityType.abstract.ts).
//
// The two flags the UI gates date-editing on:
//   - `isCanEditDates` — PendingTrips opens its date-edit popover only when true.
//   - `isHasETA`       — ActivityGantt shows the estimated/actual date pickers.
//
// Stored as MSSQL `bit`, so the bridge may surface them as boolean | 0 | 1 |
// null depending on the driver — every consumer must treat them as truthy/falsy
// rather than `=== true`.
// ---------------------------------------------------------------------------

export interface ActivityType {
  activityTypeId?: number | null
  code?: string | null
  name?: string | null
  abbreviation?: string | null
  description?: string | null
  isPerformedAtOrigin?: boolean | number | null
  isPerformedAtDestination?: boolean | number | null
  isCanEditDates?: boolean | number | null
  isHasETA?: boolean | number | null
  sequencePriority?: number | null
}
