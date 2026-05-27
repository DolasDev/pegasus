// ---------------------------------------------------------------------------
// Cloud-direct port of updateTripSummaryInfo (trips.repository.ts).
//
// Recomputes a trip's roll-up columns from the activities currently assigned to
// it (origin/destination, total lbs, linehaul, day span, load/VIP counts) and
// persists them on TripMaster. Shared by the activity write handlers (Unit 2),
// the /trips/:id/summary endpoint (Unit 3), and trip-save (Unit 5).
//
// Faithful to the on-prem behaviour, including its quirks: findShipmentsByIds
// selects only v_longhaul_shipments_v2.* (no `sales` columns, no enriched
// origin_state/destination_state objects), and that view exposes `vip`,
// `total_est_wt`, `line_haul` but NOT `total_actual_wt`, `supervip`, or the
// state objects. So total_actual_lbs and supervip_count compute to 0 and the
// state ids to null on both paths — we replicate that rather than "fixing" it.
//
// Read-compute-write across three round trips (activities, shipments, update),
// matching the on-prem repo. Not wrapped in a transaction — neither is the
// proxy; callers that need atomicity author their own batch (Unit 5).
// ---------------------------------------------------------------------------

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

export type SummaryShipmentRow = Record<string, unknown> & { order_num: number }

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
  shipmentsMap: Record<number, Record<string, unknown>>,
  field: string,
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
   * The shipment column marking a "super VIP". The two on-prem summary code
   * paths disagree: updateTripSummaryInfo (activity-save, /summary) uses
   * `supervip`; saveTripLogic (trip save) uses `idc_break`. Default `supervip`.
   * The super-VIP field is excluded from vip_count and counted in supervip_count.
   */
  superVipField?: string
}

/** Pure roll-up computation — exported for unit testing. */
export function computeTripSummary(
  activities: SummaryActivityRow[],
  shipments: SummaryShipmentRow[],
  options: ComputeTripSummaryOptions = {},
): TripSummary {
  const superVipField = options.superVipField ?? 'supervip'
  const shipmentsMap: Record<number, Record<string, unknown>> = {}
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

  const originShipment = originActivity
    ? (shipmentsMap[originActivity.order_num as number] ?? {})
    : {}
  const destinationShipment = destinationActivity
    ? (shipmentsMap[destinationActivity.order_num as number] ?? {})
    : {}

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
    origin_state_id:
      ((
        (originShipment as Record<string, unknown>)['origin_state'] as
          | Record<string, unknown>
          | undefined
      )?.['state_id'] as number | null) ?? null,
    destination_state_id:
      ((
        (destinationShipment as Record<string, unknown>)['destination_state'] as
          | Record<string, unknown>
          | undefined
      )?.['state_id'] as number | null) ?? null,
    total_estimated_lbs: sumShipmentField(loads, shipmentsMap, 'total_est_wt'),
    total_actual_lbs: sumShipmentField(loads, shipmentsMap, 'total_actual_wt'),
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
  if (orderNums.length > 0) {
    const inParams = orderNums.map((n, i) => ({ name: `o${i}`, value: n }))
    const inList = inParams.map((p) => `@${p.name}`).join(', ')
    const { recordset } = await executeSql(
      connectionString,
      `SELECT order_num, vip, total_est_wt, line_haul FROM v_longhaul_shipments_v2 WHERE order_num IN (${inList})`,
      { params: inParams },
    )
    shipments = recordset as SummaryShipmentRow[]
  }

  const summary = computeTripSummary(activities, shipments)
  const params: SqlParam[] = [
    { name: 'tripId', value: tripId },
    ...Object.entries(summary).map(([name, value]) => ({ name, value })),
  ]
  const { rowsAffected } = await executeSql(connectionString, SUMMARY_UPDATE_SQL, { params })
  return rowsAffected[0] ?? 0
}
