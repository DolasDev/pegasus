// ---------------------------------------------------------------------------
// Pure planning for cloud-direct trip save — the diff half of the legacy
// saveTripLogic. Given the request DTO plus the trip's current
// state (header + activities) read from the DB, it produces:
//   - the TripMaster upsert row,
//   - the activity add / update / remove sets (the sameSlot diff),
//   - the dispatcher-change cascade target order_nums,
//   - or a guard error (driver-change-on-in-progress / remove-with-actual-date).
//
// Kept pure (no I/O) so it is unit-testable; the handler (trip-save.ts) feeds it
// the reads and turns its output into one atomic SQL batch. Mirrors the on-prem
// saveTripLogic exactly, with one safe refinement: activity inserts/updates are
// restricted to real LongDistanceDispatchActivity columns (ACTIVITY_COLUMNS),
// so the joined alias columns the on-prem path carries on `dbo`
// (activityType_code/_name/_abbreviation) can never leak into a write.
// ---------------------------------------------------------------------------

import { buildShipmentActivities } from './longhaul-build-activities'
import { mapDateOnlyColumns, isInvertedSpan } from './longhaul-date-only'

type Activity = Record<string, unknown>

/** Real LongDistanceDispatchActivity columns a save may write (excl. id, TripMaster_id, created_at, updated_at). */
export const ACTIVITY_COLUMNS = [
  'order_num',
  'ActivityType_code',
  'actual_date',
  'assigned_agent_code',
  'assigned_driver_id',
  'city',
  'estimated_date',
  'is_active',
  'is_committed',
  'is_confirmed',
  'location_id',
  'modified_by',
  'planned_end',
  'planned_start',
  'state',
  'status',
  'street',
  'trip_status_id',
  'unit',
  'zip',
] as const

/** TripMaster columns the header upsert writes (excl. id, created_date, updated_date). */
export const TRIP_COLUMNS = [
  'driver_id',
  'dispatcher_id',
  'TripStatus_id',
  'created_by_id',
  'updated_by_id',
  'origin_state_id',
  'destination_state_id',
  'finalized_id',
  'trip_title',
  'total_miles',
  'total_effective_deadhead_miles',
  'total_estimated_lbs',
  'total_actual_lbs',
  'total_estimated_linehaul_usd',
  'total_actual_linehaul_usd',
  'total_days',
  'planned_first_day',
  'planned_last_day',
  'actual_first_day',
  'actual_last_day',
  'driver_accepted_date',
  'finalized_date',
] as const

/** A row from the RT1 existing-activities read (real column + the type-code alias). */
export interface ExistingActivity {
  id: number
  order_num: number | null
  activityType_code: string | null
  actual_date: string | null
  TripMaster_id: number | null
}

export interface TripSavePlan {
  kind: 'plan'
  isUpdate: boolean
  /** The trip id for an update; null for a create (resolved from SCOPE_IDENTITY). */
  tripId: number | null
  /** TripMaster upsert values keyed by column (subset of TRIP_COLUMNS). */
  tripRow: Record<string, unknown>
  /** Dispatcher changed on an existing trip → cascade to these shipments' shadow. */
  dispatcherCascade: {
    orderNums: number[]
    operations_id: unknown
    operations_name: string
  } | null
  /** New activities (TripMaster_id is applied by the handler/SQL, not here). */
  activitiesToAdd: Activity[]
  /** Existing activities to update, keyed by id. */
  activitiesToUpdate: Array<{ id: number; fields: Activity }>
  /** Existing activity ids to delete. */
  removeIds: number[]
  /** The acting user code stamped on the removed-activity audit touch (tripDto.updated_by_id). */
  modifiedBy: number | null
  /** The trip's final activity set (= dtoActivities) — used to compute the summary. */
  finalActivities: Activity[]
}

export interface TripSaveGuardError {
  kind: 'error'
  error: string
  code: string
}

function pickReal(obj: Activity, allowed: readonly string[]): Activity {
  const out: Activity = {}
  for (const k of allowed) if (obj[k] !== undefined) out[k] = obj[k]
  return out
}

/**
 * `pickReal` for activity rows, with the four calendar-day columns collapsed to
 * naive midnight. Without this a save re-persists whatever timestamp the client
 * sent — which is how `estimated_date` ended up at 05:00 across prod and why the
 * legacy Gantt rendered two columns for one day. `mapDateOnlyColumns` is the
 * non-logging variant, so this module stays pure.
 */
function pickActivity(obj: Activity): Activity {
  return mapDateOnlyColumns(pickReal(obj, ACTIVITY_COLUMNS))
}

/** Compute the save plan, or a guard error. Pure — mirrors saveTripLogic's diff. */
export function computeTripSavePlan(
  tripDto: Record<string, unknown>,
  existingTrip: Record<string, unknown> | null,
  existingActivities: ExistingActivity[],
): TripSavePlan | TripSaveGuardError {
  const tripDtoId = tripDto['id'] as number | undefined

  // Guard: no driver change on an in-progress (>=4) trip.
  const dtoStatusId = (tripDto['status'] as Record<string, unknown> | null)?.['status_id'] as
    | number
    | undefined
  // A driver reaches us as the scalar `driver_id`, or nested on `driver` — which
  // carries `driver_id` when it came from the drivers list and additionally `id`
  // once reshapeTrip has hydrated it. Accept all three; driver 0 is the "None"
  // option rather than a real FK, so it stores as unassigned.
  const driverDto = tripDto['driver'] as Record<string, unknown> | null
  const rawDriverId = tripDto['driver_id'] ?? driverDto?.['id'] ?? driverDto?.['driver_id'] ?? null
  const driverId = rawDriverId === 0 ? null : rawDriverId
  if (existingTrip && dtoStatusId != null && dtoStatusId >= 4) {
    const existingDriverId = existingTrip['driver_id'] as number | null
    if (existingDriverId !== driverId) {
      return {
        kind: 'error',
        error: 'Cannot change driver on in-progress trip',
        code: 'VALIDATION_ERROR',
      }
    }
  }

  const dispatcherCode =
    (tripDto['dispatcher'] as Record<string, unknown> | null)?.['code'] ??
    tripDto['dispatcher_id'] ??
    null
  const dispatcherFirstName =
    (tripDto['dispatcher'] as Record<string, unknown> | null)?.['first_name'] ?? ''
  const dispatcherLastName =
    (tripDto['dispatcher'] as Record<string, unknown> | null)?.['last_name'] ?? ''
  const dispatcherName = `${dispatcherFirstName} ${dispatcherLastName}`.trim()
  const driverAgentCode =
    (tripDto['driver'] as Record<string, unknown> | null)?.['agent_code'] ?? null
  const currentStatus =
    (tripDto['status'] as Record<string, unknown> | null)?.['status'] ?? 'Pending'
  const currentStatusTripId = (tripDto['status'] as Record<string, unknown> | null)?.['id'] ?? 1
  const modifiedBy = (tripDto['updated_by_id'] as number | undefined) ?? null

  // The final activity set = what the caller sent, verbatim (saveTripLogic:
  // `activities.push(...shipment.activities)`). It must NOT be re-derived:
  // buildShipmentActivities drops every activity that already sits on a trip
  // (TripMaster_id != null) and regenerates only the four required templates, so
  // re-deriving here would silently drop the trip's own persisted activities —
  // extra types (R19I/SITIN/UNPK/XPU/...) and any required type whose trigger
  // column has since been cleared — straight into the remove set, 403ing the
  // save whenever one carries an actual_date, and discarding the planner's date
  // edits and deletions on the rest.
  //
  // Auto-fill is the fallback for a shipment that arrives with no activities at
  // all (an API client posting a bare shipment). The planner UI never hits it:
  // GET /shipments already expands the required templates (shipments-list.ts)
  // before a shipment can be added to a trip.
  const dtoShipments = (tripDto['shipments'] as Activity[]) ?? []
  const dtoActivities: Activity[] = []
  for (const shipment of dtoShipments) {
    const sent = shipment['activities'] as Activity[] | undefined
    dtoActivities.push(...(sent?.length ? sent : buildShipmentActivities(shipment)))
  }

  // Match key: same order_num + activity-type code on the same (existing) trip.
  const sameSlot = (dto: Activity, dbo: ExistingActivity): boolean =>
    dto['order_num'] === dbo.order_num &&
    ((dto['activityType'] as Record<string, unknown> | null | undefined)?.['code'] ??
      dto['ActivityType_code']) === dbo.activityType_code &&
    tripDtoId === (dbo.TripMaster_id ?? undefined)

  const activitiesToRemoveRows = existingActivities.filter(
    (dbo) => !dtoActivities.some((dto) => sameSlot(dto, dbo)),
  )
  if (activitiesToRemoveRows.some((a) => a.actual_date != null)) {
    return {
      kind: 'error',
      error: `Cannot remove ${activitiesToRemoveRows.length} activity(s) with actual dates from trip`,
      code: 'VALIDATION_ERROR',
    }
  }

  const overrides: Activity = {
    assigned_driver_id: driverId,
    assigned_agent_code: driverAgentCode,
    status: currentStatus,
    trip_status_id: currentStatusTripId,
    modified_by: modifiedBy,
  }

  const activitiesToUpdate = existingActivities
    .filter((dbo) => dtoActivities.some((dto) => sameSlot(dto, dbo)))
    .map((dbo) => {
      const matching = dtoActivities.find((dto) => sameSlot(dto, dbo))!
      return { id: dbo.id, fields: pickActivity({ ...matching, ...overrides }) }
    })

  const activitiesToAdd = dtoActivities
    .filter((dto) => !existingActivities.some((dbo) => sameSlot(dto, dbo)))
    .map((dto) => {
      const activityTypeCode =
        (dto['activityType'] as Record<string, unknown> | null)?.['code'] ??
        dto['ActivityType_code']
      return pickActivity({ ...dto, ...overrides, ActivityType_code: activityTypeCode })
    })

  // A planned span that runs backwards is always bad data. Every such row in
  // prod is the same MM/DD with the wrong year, which the Gantt renders as two
  // identically labeled columns because the header carries no year.
  const inverted = [...activitiesToUpdate.map((u) => u.fields), ...activitiesToAdd].find((a) =>
    isInvertedSpan(a['planned_start'], a['planned_end']),
  )
  if (inverted) {
    return {
      kind: 'error',
      error: `planned_end must not precede planned_start (${String(inverted['ActivityType_code'] ?? 'activity')} on order ${String(inverted['order_num'] ?? '?')})`,
      code: 'VALIDATION_ERROR',
    }
  }

  const removeIds = activitiesToRemoveRows.map((a) => a.id).filter(Boolean)

  // Trip header upsert row (subset of TRIP_COLUMNS present in the DTO).
  const tripRowFull: Record<string, unknown> = {
    driver_id: driverId,
    dispatcher_id: dispatcherCode,
    TripStatus_id: tripDto['TripStatus_id'] ?? 1,
    created_by_id: tripDto['created_by_id'] ?? null,
    updated_by_id: tripDto['updated_by_id'] ?? null,
    origin_state_id: tripDto['origin_state_id'] ?? null,
    destination_state_id: tripDto['destination_state_id'] ?? null,
    finalized_id: tripDto['finalized_id'] ?? null,
    trip_title: tripDto['trip_title'] ?? null,
    total_miles: tripDto['total_miles'] ?? null,
    total_effective_deadhead_miles: tripDto['total_effective_deadhead_miles'] ?? null,
    total_estimated_lbs: tripDto['total_estimated_lbs'] ?? null,
    total_actual_lbs: tripDto['total_actual_lbs'] ?? null,
    total_estimated_linehaul_usd:
      tripDto['total_estimated_linehaul'] ?? tripDto['total_estimated_linehaul_usd'] ?? null,
    total_actual_linehaul_usd: tripDto['total_actual_linehaul_usd'] ?? null,
    total_days: tripDto['total_days'] ?? null,
    planned_first_day: tripDto['planned_first_day'] ?? null,
    planned_last_day: tripDto['planned_last_day'] ?? null,
    actual_first_day: tripDto['actual_first_day'] ?? null,
    actual_last_day: tripDto['actual_last_day'] ?? null,
    driver_accepted_date: tripDto['driver_accepted_date'] ?? null,
    finalized_date: tripDto['finalized_date'] ?? null,
  }
  const tripRow: Record<string, unknown> = {}
  for (const col of TRIP_COLUMNS) tripRow[col] = tripRowFull[col] ?? null

  let dispatcherCascade: TripSavePlan['dispatcherCascade'] = null
  if (existingTrip && existingTrip['dispatcher_id'] !== dispatcherCode) {
    const orderNums = [
      ...new Set(existingActivities.map((a) => a.order_num as number).filter(Boolean)),
    ]
    if (orderNums.length > 0) {
      dispatcherCascade = {
        orderNums,
        operations_id: dispatcherCode,
        operations_name: dispatcherName,
      }
    }
  }

  return {
    kind: 'plan',
    isUpdate: tripDtoId != null,
    tripId: tripDtoId ?? null,
    tripRow,
    dispatcherCascade,
    activitiesToAdd,
    activitiesToUpdate,
    removeIds,
    modifiedBy,
    finalActivities: dtoActivities,
  }
}
