// ---------------------------------------------------------------------------
// LocalDispatchJobs → itinerary items. Pure.
//
// A local job is one row per order per service day (per branch), and the acts
// performed that day are a space-separated token string in `services`. What
// the 2026-10-25 prod check (NW, QMM, RVS; plan Phase 0) established, and this
// module encodes:
//
//   • Whitespace is the only separator; RVS pads with trailing spaces.
//   • Repeats are mirrored (`PACK R19I R19I PACK`) — the string is two lists
//     joined, not a count — so one item per DISTINCT token.
//   • Hand-typed tokens outside the generator's vocabulary exist (QMM: `WHSE`,
//     `MILE`, `MEET`). They are shown, flagged `known: false`, never dropped.
//   • An empty `services` still means the driver works that order that day.
//   • The job's own location text is almost never filled (NW 7 %, QMM/RVS 0),
//     so the place comes from the ORDER, chosen by the act's side.
//   • `is_final = 'Y'` is what fires TriggerLocalDispatchUpdate to stamp
//     `sales.*_actual = service_date`, so a final job's acts are done on its
//     service date.
// ---------------------------------------------------------------------------

import type { ActivityTypeEntry, ItineraryItem, ItinerarySide, OrderPlaces } from './types'
import { STORAGE_CODES, UNKNOWN_SEQUENCE, day, flag, realId, text, wallClock } from './values'

/** The `LocalDispatchJobs` columns the itinerary reads. */
export interface LocalJobRow {
  id: number
  order_num: number
  service_date: unknown
  services: unknown
  active: unknown
  is_final: unknown
  is_confirmed: unknown
  eta_minimum: unknown
  eta_maximum: unknown
  service_at_orig: unknown
  service_at_dest: unknown
  OriginLocation1: unknown
  DestinationLocation1: unknown
  driver_id1: unknown
  driver_id2: unknown
}

/**
 * Codes movemanager's `LocalDispatchJobServicesFor*` (Sale.vb) emits that no
 * tenant's `Longhaul_ActivityType` carries. The catalog wins when it has one.
 * Sequences slot each beside its nearest longhaul neighbour.
 */
const LOCAL_ONLY_CODES: Record<string, { name: string; side: ItinerarySide; sequence: number }> = {
  CTN: { name: 'Carton Delivery', side: 'origin', sequence: 5 },
  WP: { name: 'Wrap', side: 'origin', sequence: 15 },
  ALD: { name: 'Auto Load', side: 'origin', sequence: 25 },
  LOPU: { name: 'Local Pickup', side: 'origin', sequence: 35 },
  OVPU: { name: 'Overflow Pickup', side: 'origin', sequence: 36 },
  ADEL: { name: 'Auto Delivery', side: 'destination', sequence: 95 },
  OVDEL: { name: 'Overflow Delivery', side: 'destination', sequence: 96 },
  DBR: { name: 'Debris Pickup', side: 'destination', sequence: 105 },
  PIER: { name: 'Pier/Air Pickup', side: 'neither', sequence: 140 },
  RTG: { name: 'Return to Gateway', side: 'neither', sequence: 150 },
}

/** The distinct tokens of a `services` string, in first-seen order. */
export function splitServices(services: unknown): string[] {
  if (typeof services !== 'string') return []
  return [...new Set(services.trim().toUpperCase().split(/\s+/).filter(Boolean))]
}

function catalogSide(entry: ActivityTypeEntry): ItinerarySide {
  if (entry.isPerformedAtOrigin && !entry.isPerformedAtDestination) return 'origin'
  if (entry.isPerformedAtDestination && !entry.isPerformedAtOrigin) return 'destination'
  return 'neither'
}

/** For a token nothing names: the job's own "serviced at" flags, when they agree on one side. */
function flagSide(row: LocalJobRow): ItinerarySide {
  const orig = flag(row.service_at_orig)
  const dest = flag(row.service_at_dest)
  if (orig && !dest) return 'origin'
  if (dest && !orig) return 'destination'
  return 'neither'
}

interface ResolvedAct {
  name: string
  known: boolean
  side: ItinerarySide
  sequence: number
}

function resolveAct(
  token: string | null,
  row: LocalJobRow,
  catalog: ReadonlyMap<string, ActivityTypeEntry>,
): ResolvedAct {
  if (token === null) {
    return { name: 'Local job', known: true, side: flagSide(row), sequence: UNKNOWN_SEQUENCE }
  }
  const entry = catalog.get(token)
  if (entry) {
    return {
      name: entry.name ?? entry.abbreviation ?? token,
      known: true,
      side: catalogSide(entry),
      sequence: entry.sequencePriority ?? UNKNOWN_SEQUENCE,
    }
  }
  const local = LOCAL_ONLY_CODES[token]
  if (local) return { ...local, known: true }
  return { name: token, known: false, side: flagSide(row), sequence: UNKNOWN_SEQUENCE }
}

/**
 * The itinerary items for one local job. Empty for an inactive job or one with
 * no service date — the SQL already excludes both; this holds the rule here too.
 */
export function localJobItems(
  row: LocalJobRow,
  places: OrderPlaces | null,
  catalog: ReadonlyMap<string, ActivityTypeEntry>,
): ItineraryItem[] {
  if (text(row.active)?.toUpperCase() === 'N') return []
  const serviceDay = day(row.service_date)
  if (!serviceDay) return []

  const tokens = splitServices(row.services)
  const final = flag(row.is_final)
  const start = wallClock(row.eta_minimum)
  const end = wallClock(row.eta_maximum)
  const drivers = [realId(row.driver_id1), realId(row.driver_id2)].filter(
    (id): id is number => id !== null,
  )

  const items = (tokens.length > 0 ? tokens : [null]).map((token): ItineraryItem => {
    const act = resolveAct(token, row, catalog)
    const storage = token !== null && STORAGE_CODES.has(token)
    const place =
      storage || act.side === 'neither'
        ? null
        : ((act.side === 'origin' ? places?.origin : places?.destination) ?? null)
    const note =
      act.side === 'destination' ? text(row.DestinationLocation1) : text(row.OriginLocation1)
    return {
      key: `local-job-token:${row.id}:${token ?? '-'}`,
      source: { kind: 'local-job-token', jobId: row.id, token },
      orderNum: row.order_num,
      shipperName: places?.shipperName ?? null,
      actCode: token,
      actName: act.name,
      known: act.known,
      kind: storage ? 'storage' : 'act',
      side: act.side,
      place,
      placeNote: note,
      day: serviceDay,
      plannedStart: serviceDay,
      plannedEnd: serviceDay,
      estimated: null,
      actual: final ? serviceDay : null,
      arrivalWindow: start && end ? { start, end, tz: null } : null,
      committed: false,
      confirmed: flag(row.is_confirmed),
      sequence: act.sequence,
      tripId: null,
      tripStatus: null,
      drivers: { longhaul: [], local: [...new Set(drivers)] },
    }
  })
  return items.sort((a, b) => a.sequence - b.sequence)
}
