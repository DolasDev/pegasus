// ---------------------------------------------------------------------------
// Cloud-direct port of updateTripSummaryInfo (trips.repository.ts).
//
// Recomputes a trip's roll-up columns from the activities currently assigned to
// it (origin/destination, total lbs, linehaul, day span, load/VIP counts) and
// persists them on TripMaster. Shared by the activity write handlers (Unit 2),
// the /trips/:id/summary endpoint (Unit 3), and trip-save (Unit 5).
//
// FIELD NAMES ARE VERIFIED AGAINST THE VIEW, NOT THE LEGACY ENTITY.
//
// This file previously summed `total_actual_wt` and counted super-VIPs via
// `supervip`, and read `origin_state`/`destination_state` as nested objects —
// none of which v_longhaul_shipments_v2 projects. Every one silently produced
// `Number(undefined) || 0`, so total_actual_lbs and supervip_count wrote 0 and
// the state ids wrote null, over the top of correct legacy values. A comment
// here used to claim on-prem behaved the same way; it did not. Prod trip 16575
// stored total_actual_lbs = 7900 = 2480 + 1540 + 3880, the `weight` column of
// its three load shipments. 337 NWI trips (4,289,839 lbs) had been zeroed by
// the time this was caught.
//
// The real columns (INFORMATION_SCHEMA, prod NWI, 2026-08-06):
//   actual weight  → `weight`      (int, ordinal 46 — the pair to total_est_wt at 45,
//                                   and the same value the view projects from sales.weight,
//                                   i.e. the editable "Actual Weight" in the UI)
//   super VIP      → `idc_break`   (there is no `supervip` column — see #571)
//   state ids      → `shipper_state` / `consignee_state` are 2-char geo codes;
//                    resolve via v_longhaul_states.geo_code → .id (verified exact
//                    on 10/10 legacy-populated trips)
//
// Anything read off a shipment row here MUST be a LonghaulShipmentViewColumn —
// the row type enforces it, which is the whole point of @pegasus/longhaul-contracts.
//
// Read-compute-write across three round trips (activities, shipments+states,
// update), matching the on-prem repo. Not wrapped in a transaction — neither is
// the proxy; callers that need atomicity author their own batch (Unit 5).
// ---------------------------------------------------------------------------

import type {
  LonghaulShipmentViewColumn,
  LonghaulShipmentViewRow,
} from '@pegasus/longhaul-contracts'
import { executeSql, type SqlParam } from './mssql-executor-client'

const LOAD_ACTIVITY_CODES = ['LOAD', 'R19O']
const ONE_DAY_MS = 1000 * 60 * 60 * 24

export interface SummaryActivityRow {
  order_num: number | null
  actual_date: string | null
  estimated_date: string | null
  planned_start: string | null
  planned_end: string | null
  ActivityType_code: string | null
}

/**
 * A shipment row as the summary queries select it — typed against the view's
 * column manifest so that naming a column the view does not project is a
 * compile error rather than a silent 0. That is exactly how `total_actual_wt`,
 * `supervip` and the `origin_state` object survived here.
 */
export type SummaryShipmentRow = LonghaulShipmentViewRow & { order_num: number }

/** `v_longhaul_states.geo_code` (e.g. "NY") → `v_longhaul_states.id`. */
export type StateIdByGeoCode = Record<string, number>

/** The columns the summary roll-up needs off the shipment view. */
export const SUMMARY_SHIPMENT_COLUMNS = [
  'order_num',
  'vip',
  'idc_break',
  'total_est_wt',
  'weight',
  'line_haul',
  'shipper_state',
  'consignee_state',
] as const satisfies readonly LonghaulShipmentViewColumn[]

export interface TripSummary {
  origin_state_id: number | null
  destination_state_id: number | null
  total_estimated_lbs: number
  total_actual_lbs: number
  total_estimated_linehaul_usd: number
  total_actual_linehaul_usd: number
  total_days: number
  planned_first_day: string | null
  planned_last_day: string | null
  load_activity_count: number
  vip_count: number
  supervip_count: number
}

function daysBetween(date1: unknown, date2: unknown): number {
  if (!date1 || !date2) return 0
  const ms = Math.abs(new Date(date1 as string).getTime() - new Date(date2 as string).getTime())
  return Math.round(ms / ONE_DAY_MS) + 1
}

function sumShipmentField(
  activities: SummaryActivityRow[],
  shipmentsMap: Record<number, SummaryShipmentRow>,
  field: LonghaulShipmentViewColumn,
): number {
  return activities.reduce((acc, a) => {
    const shipment = shipmentsMap[a.order_num as number]
    return acc + (Number(shipment?.[field]) || 0)
  }, 0)
}

function effectiveStart(a: SummaryActivityRow): number {
  const v = a.actual_date || a.estimated_date || a.planned_start
  return v ? new Date(v).getTime() : 0
}

function effectiveEnd(a: SummaryActivityRow): number {
  const v = a.actual_date || a.estimated_date || a.planned_end
  return v ? new Date(v).getTime() : 0
}

export interface ComputeTripSummaryOptions {
  /**
   * The shipment column marking a "super VIP", excluded from vip_count and
   * counted in supervip_count.
   *
   * The two on-prem paths *name* this differently — updateTripSummaryInfo says
   * `supervip`, saveTripLogic says `idc_break` — but the view has only
   * `idc_break` (#571), so `supervip` counted nothing on either path. The
   * default is `idc_break`; the option remains because the legacy disagreement
   * is real and a caller may need to pin it.
   */
  superVipField?: LonghaulShipmentViewColumn

  /**
   * `v_longhaul_states.geo_code` → `.id`, used to resolve the origin and
   * destination state ids from the shipments' 2-char state codes. Omitted (or
   * missing a code) leaves the corresponding id null, which is what the trip
   * header renders as a blank state.
   */
  stateIdByGeoCode?: StateIdByGeoCode
}

/** Pure roll-up computation — exported for unit testing. */
export function computeTripSummary(
  activities: SummaryActivityRow[],
  shipments: SummaryShipmentRow[],
  options: ComputeTripSummaryOptions = {},
): TripSummary {
  const superVipField = options.superVipField ?? 'idc_break'
  const stateIdByGeoCode = options.stateIdByGeoCode ?? {}
  const shipmentsMap: Record<number, SummaryShipmentRow> = {}
  for (const s of shipments) shipmentsMap[s.order_num] = s

  const orderNums = [...new Set(activities.map((a) => a.order_num as number).filter(Boolean))]

  const loads = activities.filter(
    (a) => a.ActivityType_code != null && LOAD_ACTIVITY_CODES.includes(a.ActivityType_code),
  )

  const vipCount = new Set(
    orderNums.filter((n) => {
      const s = shipmentsMap[n]
      return s?.['vip'] === 'Y' && s?.[superVipField] !== 'Y'
    }),
  ).size
  const supervipCount = new Set(orderNums.filter((n) => shipmentsMap[n]?.[superVipField] === 'Y'))
    .size

  const originActivity = [...activities].sort((a, b) => effectiveStart(a) - effectiveStart(b))[0]
  const destinationActivity = [...activities].sort((a, b) => effectiveEnd(b) - effectiveEnd(a))[0]

  const originShipment: Partial<SummaryShipmentRow> = originActivity
    ? (shipmentsMap[originActivity.order_num as number] ?? {})
    : {}
  const destinationShipment: Partial<SummaryShipmentRow> = destinationActivity
    ? (shipmentsMap[destinationActivity.order_num as number] ?? {})
    : {}

  // The view carries 2-char geo codes, not the state ids TripMaster stores.
  // Codes are padded/cased inconsistently in the legacy data, and non-states
  // like "XX" and "" appear — an unmatched code resolves to null, same as absent.
  const stateId = (code: unknown): number | null => {
    if (typeof code !== 'string') return null
    const key = code.trim().toUpperCase()
    return key ? (stateIdByGeoCode[key] ?? null) : null
  }

  const plannedFirstDay =
    originActivity?.actual_date ||
    originActivity?.estimated_date ||
    originActivity?.planned_start ||
    null
  const plannedLastDay =
    destinationActivity?.actual_date ||
    destinationActivity?.estimated_date ||
    destinationActivity?.planned_end ||
    null

  return {
    origin_state_id: stateId(originShipment.shipper_state),
    destination_state_id: stateId(destinationShipment.consignee_state),
    total_estimated_lbs: sumShipmentField(loads, shipmentsMap, 'total_est_wt'),
    total_actual_lbs: sumShipmentField(loads, shipmentsMap, 'weight'),
    total_estimated_linehaul_usd: sumShipmentField(loads, shipmentsMap, 'line_haul'),
    total_actual_linehaul_usd: sumShipmentField(loads, shipmentsMap, 'line_haul'),
    total_days: daysBetween(plannedFirstDay, plannedLastDay),
    planned_first_day: plannedFirstDay,
    planned_last_day: plannedLastDay,
    load_activity_count: loads.length,
    vip_count: vipCount,
    supervip_count: supervipCount,
  }
}

/**
 * The state reference table. 60-odd rows and effectively static, so both summary
 * paths just re-read it inside their existing round trip rather than caching it.
 */
export const STATES_SQL = `SELECT id, geo_code FROM v_longhaul_states`

/** Build the geo_code → id lookup, normalized the same way `stateId` looks up. */
export function buildStateIdByGeoCode(rows: readonly unknown[]): StateIdByGeoCode {
  const map: StateIdByGeoCode = {}
  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null) continue
    const row = raw as Record<string, unknown>
    const code = row['geo_code']
    // Number(null) is 0 and Number('') is 0 — both finite — so check the raw
    // value is numeric before coercing, and require a positive id.
    const rawId = row['id']
    const id = typeof rawId === 'number' ? rawId : Number.parseInt(String(rawId ?? ''), 10)
    if (typeof code !== 'string' || !Number.isFinite(id) || id <= 0) continue
    const key = code.trim().toUpperCase()
    // First row wins: geo_code is not unique (both "AB" and "BC" map to CANADA),
    // and v_longhaul_states is ordered by id, so this keeps the lowest id.
    if (key && !(key in map)) map[key] = id
  }
  return map
}

const ACTIVITIES_SQL = `
SELECT order_num, actual_date, estimated_date, planned_start, planned_end, ActivityType_code
FROM LongDistanceDispatchActivity
WHERE TripMaster_id = @tripId
`

const SUMMARY_UPDATE_SQL = `
UPDATE TripMaster SET
  origin_state_id = @origin_state_id,
  destination_state_id = @destination_state_id,
  total_estimated_lbs = @total_estimated_lbs,
  total_actual_lbs = @total_actual_lbs,
  total_estimated_linehaul_usd = @total_estimated_linehaul_usd,
  total_actual_linehaul_usd = @total_actual_linehaul_usd,
  total_days = @total_days,
  planned_first_day = @planned_first_day,
  planned_last_day = @planned_last_day,
  load_activity_count = @load_activity_count,
  vip_count = @vip_count,
  supervip_count = @supervip_count,
  updated_date = GETDATE()
WHERE id = @tripId
`

/**
 * Recompute and persist a trip's summary via the executor. No-op (returns 0)
 * when the trip has no activities — matching the on-prem repo, which leaves
 * stale values in place rather than zeroing them.
 */
export async function recomputeTripSummaryCloud(
  connectionString: string,
  tripId: number,
): Promise<number> {
  const { recordset: activityRows } = await executeSql(connectionString, ACTIVITIES_SQL, {
    params: [{ name: 'tripId', value: tripId }],
  })
  const activities = activityRows as SummaryActivityRow[]
  if (activities.length === 0) return 0

  const orderNums = [...new Set(activities.map((a) => a.order_num as number).filter(Boolean))]
  let shipments: SummaryShipmentRow[] = []
  let stateIdByGeoCode: StateIdByGeoCode = {}
  if (orderNums.length > 0) {
    const inParams = orderNums.map((n, i) => ({ name: `o${i}`, value: n }))
    const inList = inParams.map((p) => `@${p.name}`).join(', ')
    // Two statements, one round trip: the shipments, then the (small, static)
    // state reference table used to resolve geo codes to TripMaster's state ids.
    const { recordsets } = await executeSql(
      connectionString,
      `SELECT ${SUMMARY_SHIPMENT_COLUMNS.join(', ')} FROM v_longhaul_shipments_v2 WHERE order_num IN (${inList});\n${STATES_SQL}`,
      { params: inParams },
    )
    shipments = (recordsets[0] ?? []) as SummaryShipmentRow[]
    stateIdByGeoCode = buildStateIdByGeoCode(recordsets[1] ?? [])
  }

  const summary = computeTripSummary(activities, shipments, { stateIdByGeoCode })
  const params: SqlParam[] = [
    { name: 'tripId', value: tripId },
    ...Object.entries(summary).map(([name, value]) => ({ name, value })),
  ]
  const { rowsAffected } = await executeSql(connectionString, SUMMARY_UPDATE_SQL, { params })
  return rowsAffected[0] ?? 0
}
