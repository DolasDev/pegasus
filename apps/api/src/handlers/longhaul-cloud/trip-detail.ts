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
//   RT2 — shipments + their activities + coverage + extra locations for the
//         trip's distinct order_nums, also a single multi-statement batch.
//         Skipped entirely when the trip has no shipment-bearing activities.
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

type Row = Record<string, unknown>

// RT1: trip header (6 LEFT JOINs, mirrors findTripById), activities, notes.
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
       at.abbreviation AS activityType_abbreviation
FROM LongDistanceDispatchActivity a
LEFT JOIN Longhaul_ActivityType at ON a.ActivityType_code = at.code
WHERE a.TripMaster_id = @id;

SELECT * FROM TripNotes WHERE tripId = @id;
`

/** RT2: shipments + their activities + coverage + extra locations, batched by order_num. */
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
       drv.driver_name AS driver_name
FROM LongDistanceDispatchActivity a
LEFT JOIN Longhaul_ActivityType at ON a.ActivityType_code = at.code
LEFT JOIN v_longhaul_drivers drv ON a.assigned_driver_id = drv.driver_id
WHERE a.order_num IN (${inList});

SELECT * FROM longhaul_shipmentcoverage WHERE order_num IN (${inList});

SELECT * FROM pegasus_extra_location WHERE order_num IN (${inList});
`
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
    // The executor concatenates recordsets in statement order; we slice them
    // back apart by the row shapes we know each SELECT returns.
    const bundle = await executeSql(connectionString, TRIP_BUNDLE_SQL, {
      params: [{ name: 'id', value: id }],
    })
    const { trip, activities, notes } = splitTripBundle(bundle.recordset as Row[], id)

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
      // RT2 — shipments + their activities/coverage/extra-locations, batched.
      const params: SqlParam[] = orderNums.map((on, i) => ({ name: `on${i}`, value: on }))
      const shipBundle = await executeSql(connectionString, buildShipmentBundleSql(orderNums), {
        params,
      })
      shipments = assembleShipments(shipBundle.recordset as Row[], orderNums, id)
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
// Recordset splitters
//
// The mssql-executor flattens a multi-statement batch into one `recordset`
// array. We can't see statement boundaries directly, so we partition rows by
// the marker columns each SELECT uniquely produces:
//   - trip row     → carries `TripStatus_id` (a TripMaster column)
//   - activity row → carries `TripMaster_id`
//   - note row     → carries `tripId`
// The shipment bundle is partitioned the same way against its four SELECTs.
// ---------------------------------------------------------------------------

interface SplitTripBundle {
  trip: Row | null
  activities: Row[]
  notes: Row[]
}

function splitTripBundle(rows: Row[], tripId: number): SplitTripBundle {
  let trip: Row | null = null
  const activities: Row[] = []
  const notes: Row[] = []

  for (const row of rows) {
    if ('TripMaster_id' in row) {
      activities.push(row)
    } else if ('tripId' in row && !('TripStatus_id' in row)) {
      notes.push(row)
    } else if (Number(row['id']) === tripId && 'TripStatus_id' in row) {
      trip = row
    }
  }

  return { trip, activities, notes }
}

function assembleShipments(rows: Row[], orderNums: number[], tripId: number): Row[] {
  const orderSet = new Set(orderNums)

  // A shipment row is the only one of the four SELECTs that lacks all of the
  // activity / coverage / extra-location marker columns. Activities carry
  // `TripMaster_id`; coverage rows carry `activity_code`; extra-location rows
  // carry `location_type`. Everything else with an `order_num` is a shipment.
  const shipments: Row[] = []
  const activities: Row[] = []
  const coverages: Row[] = []
  const extraLocations: Row[] = []

  for (const row of rows) {
    if ('TripMaster_id' in row) {
      activities.push(row)
    } else if ('activity_code' in row) {
      coverages.push(row)
    } else if ('location_type' in row) {
      extraLocations.push(row)
    } else if (orderSet.has(Number(row['order_num']))) {
      shipments.push(row)
    }
  }

  const activitiesByOrder = groupBy(activities, 'order_num')
  const extraByOrder = groupBy(extraLocations, 'order_num')
  const coverageByOrder: Record<number, Row> = {}
  for (const cov of coverages) {
    coverageByOrder[cov['order_num'] as number] = cov
  }

  return shipments.map((s) => {
    const on = s['order_num'] as number
    return {
      ...s,
      // Mirror the on-prem handler: a shipment's embedded activities are
      // filtered down to those on THIS trip.
      activities: (activitiesByOrder[on] ?? []).filter((a) => a['TripMaster_id'] === tripId),
      packing_coverage: coverageByOrder[on] ?? null,
      extra_locations: extraByOrder[on] ?? [],
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
