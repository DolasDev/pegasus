// ---------------------------------------------------------------------------
// Driver itinerary — the row contract.
//
// One item is one act a driver has to perform for one order on one day: the
// domain reference's `stopAction` (one act × one shipment × one stop), read
// off the two legacy places a driver's work lives today:
//
//   • `LongDistanceDispatchActivity` — one row per act, on a longhaul trip;
//   • `LocalDispatchJobs`             — one row per order per service day, its
//     acts packed into a space-separated `services` string.
//
// The trip is a grouping on the item (`tripId`), never the way in: a local job
// has no trip, and the itinerary reads both the same way. Stops are not stored
// — a client groups items by day + place.
//
// Plan: plans/in-progress/driver-itinerary.md.
// ---------------------------------------------------------------------------

/** Where an item was read from. Open by design: a third source is planned. */
export type ItinerarySource =
  | { kind: 'longhaul-activity'; activityId: number }
  | { kind: 'local-job-token'; jobId: number; token: string | null }

export type ItinerarySide = 'origin' | 'destination' | 'neither'

/**
 * `storage` marks work that is about a SIT stay or the warehouse rather than a
 * visit to the customer (A5 §3.3: SIT is a `stay`, not a stop action). Shown,
 * but never given a customer address.
 */
export type ItineraryKind = 'act' | 'storage'

export interface ItineraryPlace {
  street: string | null
  unit: string | null
  city: string | null
  state: string | null
  zip: string | null
}

export interface ItineraryArrivalWindow {
  /** Local `HH:mm`. */
  start: string
  end: string
  /** IANA zone, or null when the source carries none (local jobs). */
  tz: string | null
}

export interface ItineraryItem {
  /** Stable across reads: `<source kind>:<id>[:<token>]`. */
  key: string
  source: ItinerarySource
  orderNum: number
  shipperName: string | null
  /**
   * The act's code (PACK, LOAD, RDEL, …), or null for a local job whose
   * `services` is empty — the driver still has work that day.
   */
  actCode: string | null
  actName: string
  /** False for a hand-typed local token the tenant's catalog doesn't know. */
  known: boolean
  kind: ItineraryKind
  side: ItinerarySide
  place: ItineraryPlace | null
  /** Free text the dispatcher typed on a local job, shown as-is. */
  placeNote: string | null
  /** `YYYY-MM-DD` — the one date rule, see `itineraryDay`. */
  day: string
  plannedStart: string | null
  plannedEnd: string | null
  estimated: string | null
  actual: string | null
  arrivalWindow: ItineraryArrivalWindow | null
  committed: boolean
  confirmed: boolean
  /** Ordering within a day, from the tenant's activity-type catalog. */
  sequence: number
  tripId: number | null
  /** The trip's `MasterTripStatus` name (e.g. `Offered`), or null off a trip. */
  tripStatus: string | null
  /**
   * The legacy drivers on the row, each list in its own numbering space
   * (`v_longhaul_drivers.driver_id` vs `crews.employee_id` — never compare
   * across them). An activity has at most one owner; a local job up to two.
   */
  drivers: { longhaul: number[]; local: number[] }
}

/** One `Longhaul_ActivityType` row, as the itinerary needs it. Per tenant. */
export interface ActivityTypeEntry {
  code: string
  name: string | null
  abbreviation: string | null
  isPerformedAtOrigin: boolean
  isPerformedAtDestination: boolean
  sequencePriority: number | null
}

/** The order's two addresses, from `sales`. */
export interface OrderPlaces {
  shipperName: string | null
  origin: ItineraryPlace | null
  destination: ItineraryPlace | null
}
