// ---------------------------------------------------------------------------
// LongDistanceDispatchActivity → itinerary item. Pure.
//
// An activity already IS one act on one order, so this is a field mapping. Two
// rules worth stating:
//
//   • The day is `actual ?? estimated ?? planned_start` — where the work
//     happened if it has, else when it's expected, else when it was planned.
//     (The Services board files by `estimated ?? planned_start`; the itinerary
//     moves done work to the day it was done.)
//   • The owner is the ETA editor's: the assigned driver, else the trip's
//     driver (lib/longhaul-driver-activity.ts). An activity assigned to driver
//     B on driver A's trip is on B's itinerary, not A's.
//
// The row is read with `a.*` (see itinerary/fetch.ts) because the arrival-
// window columns exist only on tenants that have set one; the joined extras
// carry an `it_` prefix no activity column can collide with (#575).
// ---------------------------------------------------------------------------

import { activityOwnerDriverId } from '../longhaul-driver-activity'
import type { ItineraryItem, ItinerarySide } from './types'
import { STORAGE_CODES, UNKNOWN_SEQUENCE, day, flag, realId, text } from './values'

export interface LonghaulActivityRow {
  id: number
  order_num: number
  TripMaster_id: unknown
  ActivityType_code: unknown
  planned_start: unknown
  planned_end: unknown
  estimated_date: unknown
  actual_date: unknown
  street: unknown
  unit: unknown
  city: unknown
  state: unknown
  zip: unknown
  is_committed: unknown
  is_confirmed: unknown
  assigned_driver_id: unknown
  /** Present only on tenants that have provisioned the window columns. */
  arrival_window_start?: unknown
  arrival_window_end?: unknown
  arrival_window_tz?: unknown
  trip_driver_id: unknown
  it_trip_status?: unknown
  it_type_name: unknown
  it_type_abbreviation: unknown
  it_type_at_origin: unknown
  it_type_at_destination: unknown
  it_type_sequence: unknown
  it_shipper_name: unknown
}

function side(row: LonghaulActivityRow): ItinerarySide {
  const orig = flag(row.it_type_at_origin)
  const dest = flag(row.it_type_at_destination)
  if (orig && !dest) return 'origin'
  if (dest && !orig) return 'destination'
  return 'neither'
}

/** The item for one activity, or null when it carries no date to place it on. */
export function longhaulActivityItem(row: LonghaulActivityRow): ItineraryItem | null {
  const plannedStart = day(row.planned_start)
  const estimated = day(row.estimated_date)
  const actual = day(row.actual_date)
  const itemDay = actual ?? estimated ?? plannedStart
  if (!itemDay) return null

  const code = text(row.ActivityType_code)?.toUpperCase() ?? null
  const name = text(row.it_type_name) ?? text(row.it_type_abbreviation)
  const storage = code !== null && STORAGE_CODES.has(code)
  const start = text(row.arrival_window_start)
  const end = text(row.arrival_window_end)
  const tz = text(row.arrival_window_tz)
  const owner = activityOwnerDriverId({
    assigned_driver_id: realId(row.assigned_driver_id),
    trip_driver_id: realId(row.trip_driver_id),
  })
  const sequence = Number(row.it_type_sequence)

  return {
    key: `longhaul-activity:${row.id}`,
    source: { kind: 'longhaul-activity', activityId: row.id },
    orderNum: row.order_num,
    shipperName: text(row.it_shipper_name),
    actCode: code,
    actName: name ?? code ?? 'Activity',
    known: name !== null,
    kind: storage ? 'storage' : 'act',
    side: side(row),
    place: storage
      ? null
      : {
          street: text(row.street),
          unit: text(row.unit),
          city: text(row.city),
          state: text(row.state),
          zip: text(row.zip),
        },
    placeNote: null,
    day: itemDay,
    plannedStart,
    plannedEnd: day(row.planned_end),
    estimated,
    actual,
    arrivalWindow: start && end && tz ? { start, end, tz } : null,
    committed: flag(row.is_committed),
    confirmed: flag(row.is_confirmed),
    sequence:
      row.it_type_sequence != null && Number.isFinite(sequence) ? sequence : UNKNOWN_SEQUENCE,
    tripId: realId(row.TripMaster_id),
    tripStatus: text(row.it_trip_status),
    drivers: { longhaul: owner === null ? [] : [owner], local: [] },
  }
}
