// ---------------------------------------------------------------------------
// Shared cloud-direct longhaul trip fetch.
//
// Extracted from handlers/longhaul-cloud/trip-detail.ts so the same batched,
// round-trip-minimizing read can be reused outside the GET /trips/:id handler —
// notably by the rejected-trip snapshot creator, which needs the exact
// `{ ...trip, activities, notes, shipments }` shape the trip view renders.
//
// IMPORTANT: this is all READS. LongDistanceDispatchActivity carries enabled
// AFTER triggers; copying a trip by re-writing MSSQL would re-fire them. The
// rejected-trip feature snapshots into Postgres precisely to avoid that, so
// this read-only fetch is the correct seam to reuse.
//
// The on-prem handler makes ~4 logical steps that expand to ~8 MSSQL queries.
// This collapses the fan-out into two batched round trips:
//
//   RT1 — trip header (6 LEFT JOINs) + activities + notes in one batch.
//   RT2 — shipments + their activities + coverage for the trip's distinct
//         order_nums, in one batch. Extra locations are fetched alongside it as
//         a SEPARATE, soft-failing query (the `pegasus_extra_location` table is
//         absent on some tenants). Both are skipped when the trip has no
//         shipment-bearing activities.
//
// Multi-statement result handling: the mssql-executor surfaces every statement
// via `recordsets[i]`. We slice by index, NOT by marker columns —
// `result.recordset` carries only the FIRST statement's rows under the `mssql`
// package's API, which silently drops activities/notes/coverage/extra-locations.
// ---------------------------------------------------------------------------

import { executeSql, type SqlParam } from './mssql-executor-client'
import { logger } from './logger'
import {
  buildExtraShipmentActivities,
  dedupeByOrderNum,
  type ActivityType,
  type ShipmentRow,
} from './longhaul-shipment-enrich'
import { enrichActivityArrivalWindow } from './longhaul-arrival-window'

type Row = Record<string, unknown>

/** Trip detail shape returned to callers: trip header plus embedded collections. */
export type TripDetail = Row & {
  activities: Row[]
  notes: Row[]
  shipments: Row[]
}

// RT1: trip header (6 LEFT JOINs, mirrors findTripById), activities, notes.
// Three statements → recordsets[0] = header rows, [1] = activities, [2] = notes.
const TRIP_BUNDLE_SQL = `
SELECT t.*,
       ts.status AS status_status,
       ts.status_id AS status_id,
       drv.driver_name,
       drv.agent_code,
       os.geo_code AS origin_geo_code,
       os.geo_name AS origin_geo_name,
       ds.geo_code AS destination_geo_code,
       ds.geo_name AS destination_geo_name,
       pu.first_name AS planner_first_name,
       pu.last_name AS planner_last_name,
       du.first_name AS dispatcher_first_name,
       du.last_name AS dispatcher_last_name
FROM TripMaster t
LEFT JOIN MasterTripStatus ts ON t.TripStatus_id = ts.status_id
LEFT JOIN v_longhaul_drivers drv ON t.driver_id = drv.driver_id
LEFT JOIN v_longhaul_states os ON t.origin_state_id = os.id
LEFT JOIN v_longhaul_states ds ON t.destination_state_id = ds.id
LEFT JOIN v_longhaul_salesman pu ON t.created_by_id = pu.code
LEFT JOIN v_longhaul_salesman du ON t.dispatcher_id = du.code
WHERE t.id = @id;

SELECT a.*,
       at.code AS activityType_code,
       at.name AS activityType_name,
       at.abbreviation AS activityType_abbreviation,
       at.isCanEditDates AS activityType_isCanEditDates,
       at.isHasETA AS activityType_isHasETA
FROM LongDistanceDispatchActivity a
LEFT JOIN Longhaul_ActivityType at ON a.ActivityType_code = at.code
WHERE a.TripMaster_id = @id;

SELECT * FROM TripNotes WHERE tripId = @id;
`

/**
 * RT2: shipments + their activities + coverage + activity types, batched by
 * order_num. Four statements → recordsets[0] = shipments, [1] = activities,
 * [2] = packing coverage, [3] = activity types. Extra locations are
 * deliberately NOT in this batch — see buildExtraLocationsSql.
 */
function buildShipmentBundleSql(orderNums: number[]): string {
  const inList = orderNums.map((_, i) => `@on${i}`).join(', ')
  return `
-- No join to "sales": it contributed no columns to this SELECT (only s.* is
-- projected) but could still duplicate a shipment -- and therefore its Gantt
-- rows -- whenever an order had more than one "sales" row.
SELECT s.*
FROM v_longhaul_shipments_v2 s
WHERE s.order_num IN (${inList});

SELECT a.*,
       at.code AS activityType_code,
       at.name AS activityType_name,
       at.abbreviation AS activityType_abbreviation,
       at.isCanEditDates AS activityType_isCanEditDates,
       at.isHasETA AS activityType_isHasETA,
       drv.driver_name AS driver_name
FROM LongDistanceDispatchActivity a
LEFT JOIN Longhaul_ActivityType at ON a.ActivityType_code = at.code
LEFT JOIN v_longhaul_drivers drv ON a.assigned_driver_id = drv.driver_id
WHERE a.order_num IN (${inList});

SELECT * FROM longhaul_shipmentcoverage WHERE order_num IN (${inList});

SELECT * FROM Longhaul_ActivityType;
`
}

/**
 * Extra-locations lookup — run as its OWN single statement (not folded into the
 * RT2 batch) so it can soft-fail. `pegasus_extra_location` does not exist on
 * every tenant's DB; when absent the executor raises a query error. Batching it
 * with the mandatory shipment/activity/coverage statements would abort the
 * whole batch and 500 the trip. The caller catches the error and treats it as
 * "no extra locations".
 */
function buildExtraLocationsSql(orderNums: number[]): string {
  const inList = orderNums.map((_, i) => `@on${i}`).join(', ')
  return `SELECT * FROM pegasus_extra_location WHERE order_num IN (${inList});`
}

/**
 * Fetch a single trip with its activities, notes, and shipments from the
 * tenant's on-prem MSSQL. Returns null when the trip id does not exist.
 */
export async function fetchTripDetail(
  connectionString: string,
  tripId: number,
): Promise<TripDetail | null> {
  // RT1 — trip header + activities + notes in one multi-statement batch.
  const tripBundle = await executeSql(connectionString, TRIP_BUNDLE_SQL, {
    params: [{ name: 'id', value: tripId }],
  })
  const tripRows = (tripBundle.recordsets[0] ?? []) as Row[]
  // `SELECT a.*` already carries the arrival-window columns once a tenant has
  // them; the derived fields (the window's anchor date, its UTC instants, the
  // EDT/EST label, and what the resolver would suggest for this address) are
  // added here so no consumer — tenant-web, mobile, a workflow — ever does
  // timezone math of its own. Tenants without the columns derive all-nulls.
  const activities = ((tripBundle.recordsets[1] ?? []) as Row[]).map(enrichActivityArrivalWindow)
  const notes = (tripBundle.recordsets[2] ?? []) as Row[]

  const trip = tripRows[0]
  if (!trip) return null

  // Distinct shipment order_nums referenced by this trip's activities.
  const orderNums = [
    ...new Set(activities.map((a) => a['order_num'] as number).filter((n) => Boolean(n))),
  ]

  let shipments: Row[] = []
  if (orderNums.length > 0) {
    // RT2 — shipments + their activities/coverage in one batch, with extra
    // locations fetched in parallel as a separate, soft-failing query.
    const params: SqlParam[] = orderNums.map((on, i) => ({ name: `on${i}`, value: on }))
    const [shipBundle, extraLocations] = await Promise.all([
      executeSql(connectionString, buildShipmentBundleSql(orderNums), { params }),
      executeSql(connectionString, buildExtraLocationsSql(orderNums), { params })
        .then((r) => (r.recordsets[0] ?? []) as Row[])
        .catch((err) => {
          logger.warn('longhaul trip-fetch extra_locations lookup failed; treating as empty', {
            error: String(err),
            tripId,
          })
          return [] as Row[]
        }),
    ])
    const activityTypesMap: Record<string, ActivityType> = {}
    for (const t of (shipBundle.recordsets[3] ?? []) as Row[]) {
      const code = t['code']
      if (typeof code === 'string') activityTypesMap[code] = t as ActivityType
    }
    // The view itself can return an order more than once (617 rows for 307
    // order_nums in NWI prod), and assembleShipments maps 1:1 — so without this
    // the trip screen renders the same shipment twice. Same backstop the
    // planning list has had since #534.
    const { rows: uniqueShipments, dropped: duplicateRows } = dedupeByOrderNum(
      (shipBundle.recordsets[0] ?? []) as ShipmentRow[],
    )
    if (duplicateRows > 0) {
      logger.warn('longhaul trip-fetch dropped duplicate shipment rows from the view', {
        tripId,
        duplicateRows,
      })
    }
    shipments = assembleShipments(
      uniqueShipments as Row[],
      (shipBundle.recordsets[1] ?? []) as Row[],
      (shipBundle.recordsets[2] ?? []) as Row[],
      extraLocations,
      tripId,
      activityTypesMap,
    )
  }

  return { ...trip, activities, notes, shipments }
}

// ---------------------------------------------------------------------------
// Shipment assembly
//
// Each child collection (activities, coverage, extra-locations) arrives as its
// own recordset. We group by `order_num` and attach to each shipment. A
// shipment's embedded activities are filtered to those on THIS trip — matching
// the on-prem handler's behavior.
// ---------------------------------------------------------------------------

function assembleShipments(
  shipments: Row[],
  activities: Row[],
  coverages: Row[],
  extraLocations: Row[],
  tripId: number,
  activityTypesMap: Record<string, ActivityType>,
): Row[] {
  const activitiesByOrder = groupBy(activities.map(enrichActivityArrivalWindow), 'order_num')
  const extraByOrder = groupBy(extraLocations, 'order_num')
  const coverageByOrder: Record<number, Row> = {}
  for (const cov of coverages) {
    coverageByOrder[cov['order_num'] as number] = cov
  }

  return shipments.map((s) => {
    const on = s['order_num'] as number
    const allActivities = activitiesByOrder[on] ?? []
    const extraLocs = extraByOrder[on] ?? []
    // buildExtraShipmentActivities decides which "add activity" templates to
    // offer from the shipment's FULL activity set (mirrors the legacy
    // getShipmentsByShipmentIds, which builds extras before the trip filter).
    const extraActivities = buildExtraShipmentActivities(
      { ...s, activities: allActivities, extra_locations: extraLocs } as ShipmentRow,
      activityTypesMap,
    )
    return {
      ...s,
      // Displayed activities are still narrowed to this trip.
      activities: allActivities.filter((a) => a['TripMaster_id'] === tripId),
      packing_coverage: coverageByOrder[on] ?? null,
      extra_locations: extraLocs,
      extraActivities,
    }
  })
}

function groupBy(rows: Row[], key: string): Record<number, Row[]> {
  const out: Record<number, Row[]> = {}
  for (const row of rows) {
    const k = row[key] as number
    if (!out[k]) out[k] = []
    out[k].push(row)
  }
  return out
}
