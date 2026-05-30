// ---------------------------------------------------------------------------
// Trip response reshaper.
//
// The ported components were written against the legacy NestJS API, which
// returned trips with TypeORM *relations* nested: `trip.status`, `trip.driver`,
// `trip.originState` / `trip.destinationState`, `trip.planner`, `trip.dispatcher`,
// and `trip.activities[].activityType` / `trip.activities[].shipment`.
//
// The on-prem bridge (`apps/api/src/repositories/longhaul/trips.repository.ts`)
// is a Knex port that returns the same data *flat* — joined + column-aliased
// (`status_status`, `status_id`, `driver_name`, `origin_geo_code`,
// `planner_first_name`, `activityType_code`, …) — and attaches the trip's
// shipments as a separate `shipments` array rather than back-referencing each
// activity. Without reshaping, `TripCard` shows "Unassigned" / "undefined" for
// every relation and the trip-detail Gantt (`activity.shipment.*`) blows up.
//
// This helper rebuilds the nested shape from the flat columns. It's defensive
// (no-ops on already-nested or malformed input) so it's safe to apply
// unconditionally to every `fetchTrips` / `fetchTrip` response.
// ---------------------------------------------------------------------------

type AnyRec = Record<string, any>

function reshapeActivity(a: any): any {
  if (!a || typeof a !== 'object') return a
  // The legacy TypeORM-backed app exposed the activity PK as `activityId`; the
  // cloud-direct handler in apps/api `SELECT a.* FROM LongDistanceDispatchActivity`
  // returns the column name `id` (verified in tests/api/longhaul-qa.spec.ts).
  // The ported ActivityGantt / Trip components still read `activity.activityId`
  // for the save POST + React keys + data-activity-id selectors, so without an
  // alias every save lands on `POST /activities/undefined` and the 400 is
  // swallowed by updateActivityForTrip. Mirror the alias instead of touching
  // every call site.
  const withId = a.activityId == null && a.id != null ? { ...a, activityId: a.id } : a
  if (
    withId.activityType == null &&
    (withId.activityType_code != null || withId.ActivityType_code != null)
  ) {
    return {
      ...withId,
      activityType: {
        code: withId.activityType_code ?? withId.ActivityType_code,
        name: withId.activityType_name,
        abbreviation: withId.activityType_abbreviation,
        // `isCanEditDates` gates the PendingTrips date-edit popover and `isHasETA`
        // gates the ActivityGantt estimated/actual date pickers. The on-prem bridge
        // joins Longhaul_ActivityType and aliases these as `activityType_*`; without
        // copying them through here every persisted activity reads `undefined` →
        // falsy → the pickers never open.
        isCanEditDates: withId.activityType_isCanEditDates,
        isHasETA: withId.activityType_isHasETA,
      },
    }
  }
  return withId
}

export function reshapeTrip(raw: any): any {
  if (!raw || typeof raw !== 'object') return raw
  const t: AnyRec = { ...raw }

  if (t.status == null && (t.status_status != null || t.status_id != null)) {
    t.status = { id: t.status_id, status_id: t.status_id, status: t.status_status }
  }
  if (t.driver == null && t.driver_id != null) {
    t.driver = {
      id: t.driver_id,
      driver_id: t.driver_id,
      driver_name: t.driver_name,
      agent_code: t.agent_code,
    }
  }
  if (t.originState == null && (t.origin_geo_code != null || t.origin_state_id != null)) {
    t.originState = {
      id: t.origin_state_id,
      state_id: t.origin_state_id,
      geo_code: t.origin_geo_code,
      geo_name: t.origin_geo_name,
      zone: t.origin_zone_code,
    }
  }
  if (
    t.destinationState == null &&
    (t.destination_geo_code != null || t.destination_state_id != null)
  ) {
    t.destinationState = {
      id: t.destination_state_id,
      state_id: t.destination_state_id,
      geo_code: t.destination_geo_code,
      geo_name: t.destination_geo_name,
      zone: t.destination_zone_code,
    }
  }
  if (t.planner == null && (t.planner_first_name != null || t.created_by_id != null)) {
    t.planner = {
      code: t.created_by_id,
      first_name: t.planner_first_name,
      last_name: t.planner_last_name,
    }
  }
  if (t.dispatcher == null && (t.dispatcher_first_name != null || t.dispatcher_id != null)) {
    t.dispatcher = {
      code: t.dispatcher_id,
      first_name: t.dispatcher_first_name,
      last_name: t.dispatcher_last_name,
    }
  }

  if (Array.isArray(t.shipments)) {
    t.shipments = t.shipments.map((s: any) =>
      s && Array.isArray(s.activities)
        ? { ...s, activities: s.activities.map(reshapeActivity) }
        : s,
    )
  }

  if (Array.isArray(t.activities)) {
    t.activities = t.activities.map(reshapeActivity)
    // The trip-detail Gantt walks `activity.shipment.*`; the bridge only ships
    // the trip's `shipments` array, so stitch each shipment back onto its
    // activities by order_num.
    if (Array.isArray(t.shipments)) {
      const byOrder: Record<string, any> = {}
      for (const s of t.shipments) if (s) byOrder[String(s.order_num)] = s
      t.activities = t.activities.map((a: any) =>
        a && a.shipment == null && byOrder[String(a.order_num)] != null
          ? { ...a, shipment: byOrder[String(a.order_num)] }
          : a,
      )
    }
  }

  return t
}

export function reshapeTripList(raw: any): any {
  return Array.isArray(raw) ? raw.map(reshapeTrip) : raw
}
