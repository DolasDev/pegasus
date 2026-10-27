// ---------------------------------------------------------------------------
// Driver itinerary — the API's row contract, copied (the app never imports from
// apps/api). Source of truth: apps/api/src/lib/itinerary/types.ts.
//
// One item is one act a driver has to perform for one order on one day, read
// from either a longhaul activity or one token of a local dispatch job. Every
// date is a `YYYY-MM-DD` day.
// ---------------------------------------------------------------------------

export type ItinerarySource =
  | { kind: 'longhaul-activity'; activityId: number }
  | { kind: 'local-job-token'; jobId: number; token: string | null }

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
  tz: string | null
}

export interface ItineraryItem {
  key: string
  source: ItinerarySource
  orderNum: number
  shipperName: string | null
  /** Null for a local job with no services — the driver still works that day. */
  actCode: string | null
  actName: string
  known: boolean
  kind: 'act' | 'storage'
  side: 'origin' | 'destination' | 'neither'
  place: ItineraryPlace | null
  /** Free text a dispatcher typed on a local job, shown as-is. */
  placeNote: string | null
  day: string
  plannedStart: string | null
  plannedEnd: string | null
  estimated: string | null
  actual: string | null
  arrivalWindow: ItineraryArrivalWindow | null
  committed: boolean
  confirmed: boolean
  sequence: number
  tripId: number | null
  tripStatus: string | null
  drivers: { longhaul: number[]; local: number[] }
}

export type ItinerarySourceName = 'longhaul' | 'local'

export interface ItineraryMeta {
  count: number
  from: string
  to: string
  /** Sources that could not be read; the list is partial when non-empty. */
  failedSources: ItinerarySourceName[]
}

export interface ItineraryResponse {
  items: ItineraryItem[]
  meta: ItineraryMeta
}
