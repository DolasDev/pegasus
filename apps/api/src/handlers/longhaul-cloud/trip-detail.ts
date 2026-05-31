// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /trips/:id` handler.
//
// Phase 3 of the longhaul strangler-fig migration: serves
// GET /api/v1/onprem/longhaul/trips/:id from the cloud Hono Lambda instead of
// proxying it to the tenant's on-prem server. Mounted in app.ts ahead of the
// /onprem wildcard proxy so Hono route precedence routes /trips/:id here while
// every un-migrated longhaul endpoint still falls through to the proxy.
//
// The on-prem handler (handlers/longhaul/trips.ts + trips.repository.ts +
// shipments.repository.ts) makes ~4 logical steps that expand to ~8 MSSQL
// queries: trip header (6 LEFT JOINs); activities; notes; then a fan-out for
// every distinct order_num — shipments, their activities, coverage, and extra
// locations. A core goal of this migration is REDUCING MSSQL round trips, so
// this handler collapses the fan-out into two batched round trips:
//
//   RT1 — trip header + activities + notes in a single multi-statement batch.
//   RT2 — shipments + their activities + coverage for the trip's distinct
//         order_nums, in a single multi-statement batch. Extra locations are
//         fetched alongside it as a SEPARATE, soft-failing query (the
//         `pegasus_extra_location` table is absent on some tenants). Both are
//         skipped entirely when the trip has no shipment-bearing activities.
//
// Multi-statement result handling: the mssql-executor surfaces every statement
// in the batch via `recordsets[i]`. We slice by index, NOT by marker columns
// — an earlier version partitioned a flattened single recordset on marker
// columns (`TripMaster_id`, `tripId`, etc.), but `result.recordset` carries
// only the FIRST statement's rows under the `mssql` package's API. That
// silently dropped activities / notes / coverage / extra-locations from the
// response. Reading `recordsets` by index is the only correct approach.
//
// The response shape matches the on-prem handler exactly: `{ data: <trip> }`
// with embedded `activities`, `notes`, and `shipments` (each shipment carries
// `activities` filtered to this trip, `packing_coverage`, `extra_locations`).
// Not-found returns 404 `{ error: 'Trip not found', code: 'NOT_FOUND', ... }`.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql, type SqlParam } from '../../lib/mssql-executor-client'
import { logger } from '../../lib/logger'
import {
  buildExtraShipmentActivities,
  type ActivityType,
  type ShipmentRow,
} from '../../lib/longhaul-shipment-enrich'

type Row = Record<string, unknown>

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
 *
 * The activity-types statement feeds `buildExtraShipmentActivities` (the
 * "add activity" templates each shipment offers). The legacy trip-detail path
 * (shipment.service.ts getShipmentsByShipmentIds → buildExtraShipmentActivities)
 * attaches these to every trip shipment; without them the AddActivity menu in
 * the planning screen renders empty.
 */
function buildShipmentBundleSql(orderNums: number[]): string {
  const inList = orderNums.map((_, i) => `@on${i}`).join(', ')
  return `
SELECT s.*
FROM v_longhaul_shipments_v2 s
LEFT JOIN sales ps ON s.order_num = ps.order_num
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
 * "no extra locations", mirroring the on-prem repo's `.catch(() => [])`
 * (shipments.repository.ts) and the cloud shipments-list handler.
 */
function buildExtraLocationsSql(orderNums: number[]): string {
  const inList = orderNums.map((_, i) => `@on${i}`).join(', ')
  return `SELECT * FROM pegasus_extra_location WHERE order_num IN (${inList});`
}

export const longhaulTripDetailHandler: Handler<AppEnv> = async (c) => {
  const tenantId = c.get('tenantId')

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { mssqlConnectionString: true },
  })
  if (!tenant?.mssqlConnectionString) {
    logger.warn('Tenant has no mssqlConnectionString configured', { tenantId })
    return c.json(
      {
        error: 'Legacy database not configured for this tenant',
        code: 'MSSQL_NOT_CONFIGURED',
        correlationId: c.get('correlationId'),
      },
      422,
    )
  }
  const connectionString = tenant.mssqlConnectionString

  const id = parseInt(c.req.param('id') ?? '', 10)
  if (isNaN(id)) {
    return c.json(
      { error: 'Invalid trip id', code: 'VALIDATION_ERROR', correlationId: c.get('correlationId') },
      400,
    )
  }

  try {
    // RT1 — trip header + activities + notes in one multi-statement batch.
    const tripBundle = await executeSql(connectionString, TRIP_BUNDLE_SQL, {
      params: [{ name: 'id', value: id }],
    })
    const tripRows = (tripBundle.recordsets[0] ?? []) as Row[]
    const activities = (tripBundle.recordsets[1] ?? []) as Row[]
    const notes = (tripBundle.recordsets[2] ?? []) as Row[]

    const trip = tripRows[0]
    if (!trip) {
      return c.json(
        { error: 'Trip not found', code: 'NOT_FOUND', correlationId: c.get('correlationId') },
        404,
      )
    }

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
            logger.warn('longhaul trip-detail extra_locations lookup failed; treating as empty', {
              error: String(err),
              tripId: id,
            })
            return [] as Row[]
          }),
      ])
      const activityTypesMap: Record<string, ActivityType> = {}
      for (const t of (shipBundle.recordsets[3] ?? []) as Row[]) {
        const code = t['code']
        if (typeof code === 'string') activityTypesMap[code] = t as ActivityType
      }
      shipments = assembleShipments(
        (shipBundle.recordsets[0] ?? []) as Row[],
        (shipBundle.recordsets[1] ?? []) as Row[],
        (shipBundle.recordsets[2] ?? []) as Row[],
        extraLocations,
        id,
        activityTypesMap,
      )
    }

    return c.json({ data: { ...trip, activities, notes, shipments } })
  } catch (err) {
    logger.error('longhaul cloud trip detail failed', { error: String(err), tripId: id })
    return c.json(
      {
        error: 'Failed to fetch trip',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
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
  const activitiesByOrder = groupBy(activities, 'order_num')
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
