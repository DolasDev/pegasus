// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /driver-planning` handler.
//
// Phase 3 of the longhaul strangler-fig migration: serves
// GET /api/v1/onprem/longhaul/driver-planning from the cloud Hono Lambda
// instead of proxying it to the tenant's on-prem server. Mounted in app.ts
// ahead of the /onprem wildcard proxy so Hono route precedence routes this
// here while every un-migrated longhaul endpoint still falls through.
//
// The on-prem repository (repositories/longhaul/driver-planning.repository.ts)
// made ~5 MSSQL round trips: (1) all drivers from v_longhaul_drivers; (2) the
// latest non-cancelled trip per driver via a correlated TOP 1 subquery; (3) the
// last activity per trip via a correlated TOP 1 subquery; (4) a hasTable check
// for DriverConfirmedAvailability; (5) the confirmed-availability batch.
//
// This handler collapses (1)-(3) into ONE query: v_longhaul_drivers LEFT JOINed
// to its latest trip via OUTER APPLY (TOP 1), and that trip's last activity via
// a second OUTER APPLY (TOP 1). The DriverConfirmedAvailability lookup is a
// SECOND query that soft-fails (caught + treated as empty) exactly as the
// on-prem repo does when the table is absent on a tenant. Target: 2 round trips
// (1 if the confirmed table is missing). Response shape — `{ data, meta }` —
// matches the on-prem handler exactly.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'
import { logger } from '../../lib/logger'

// One round trip: every driver, its latest non-cancelled trip, and that trip's
// last activity. v_longhaul_drivers exposes UPPERCASE columns on the Dolios SQL
// Server — alias them to lowercase exactly as the on-prem `lowercaseRowKeys`
// normalisation does, so downstream code sees `driver_id` etc.
const PLANNING_SQL = `
SELECT
  d.DRIVER_ID   AS driver_id,
  d.DRIVER_NAME AS driver_name,
  d.AGENT_CODE  AS agent_code,
  t.id            AS trip_id,
  t.trip_title    AS trip_title,
  t.planned_last_day AS planned_last_day,
  t.actual_last_day  AS actual_last_day,
  t.destination_geo_name AS destination_geo_name,
  a.actual_date    AS act_actual_date,
  a.estimated_date AS act_estimated_date,
  a.planned_end    AS act_planned_end,
  a.city           AS act_city,
  a.state          AS act_state
FROM v_longhaul_drivers d
OUTER APPLY (
  SELECT TOP 1
    tm.id, tm.trip_title, tm.planned_last_day, tm.actual_last_day,
    ds.geo_name AS destination_geo_name
  FROM TripMaster tm
  LEFT JOIN v_longhaul_states ds ON tm.destination_state_id = ds.id
  WHERE tm.driver_id = d.DRIVER_ID
    AND ISNULL(tm.internal_status, '') <> 'canceled'
  ORDER BY COALESCE(tm.planned_last_day, tm.created_date) DESC
) t
OUTER APPLY (
  SELECT TOP 1
    la.actual_date, la.estimated_date, la.planned_end, la.city, la.state
  FROM LongDistanceDispatchActivity la
  WHERE la.TripMaster_id = t.id
  ORDER BY COALESCE(la.actual_date, la.estimated_date, la.planned_end) DESC
) a
`

// Second round trip — soft-fails when DriverConfirmedAvailability is absent.
const CONFIRMED_SQL = `
SELECT driver_id, confirmed_date, confirmed_location, notes
FROM DriverConfirmedAvailability
`

interface PlanningRow {
  driver_id: number
  driver_name: string
  agent_code: string | null
  trip_id: number | null
  trip_title: string | null
  planned_last_day: string | null
  actual_last_day: string | null
  destination_geo_name: string | null
  act_actual_date: string | null
  act_estimated_date: string | null
  act_planned_end: string | null
  act_city: string | null
  act_state: string | null
}

interface ConfirmedRow {
  driver_id: number
  confirmed_date: string | null
  confirmed_location: string | null
  notes: string | null
}

interface DriverPlanningRow {
  driverId: number
  driverName: string
  agentCode: string | null
  currentTripId: number | null
  currentTripTitle: string | null
  estimatedAvailableDate: string | null
  estimatedAvailableLocation: string | null
  confirmedAvailableDate: string | null
  confirmedAvailableLocation: string | null
  confirmedNotes: string | null
}

export const longhaulDriverPlanningHandler: Handler<AppEnv> = async (c) => {
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

  try {
    const { recordset } = await executeSql(connectionString, PLANNING_SQL)
    const rows = recordset as PlanningRow[]

    // Confirmed-availability overrides — a separate, optional round trip. The
    // DriverConfirmedAvailability table may not exist on a given tenant; the
    // on-prem repo guards with hasTable, so here we just catch the query error
    // and treat the override set as empty.
    const confirmedByDriver = new Map<number, ConfirmedRow>()
    try {
      const { recordset: confirmedRows } = await executeSql(connectionString, CONFIRMED_SQL)
      for (const row of confirmedRows as ConfirmedRow[]) {
        confirmedByDriver.set(row.driver_id, row)
      }
    } catch (confErr) {
      logger.warn('DriverConfirmedAvailability unavailable — treating as empty', {
        error: String(confErr),
      })
    }

    const data: DriverPlanningRow[] = rows.map((row) => {
      const conf = confirmedByDriver.get(row.driver_id)

      // Estimated date: last activity's actual/estimated/planned date, falling
      // back to the trip's planned_last_day then actual_last_day.
      const estimatedDate =
        row.act_actual_date ??
        row.act_estimated_date ??
        row.act_planned_end ??
        row.planned_last_day ??
        row.actual_last_day ??
        null

      // Estimated location: last activity city/state, else trip destination.
      const actCity = row.act_city
      const actState = row.act_state
      const estimatedLocation =
        actCity && actState
          ? `${actCity}, ${actState}`
          : (actCity ?? actState ?? row.destination_geo_name ?? null)

      return {
        driverId: row.driver_id,
        driverName: row.driver_name,
        agentCode: row.agent_code ?? null,
        currentTripId: row.trip_id ?? null,
        currentTripTitle: row.trip_title ?? null,
        estimatedAvailableDate: estimatedDate,
        estimatedAvailableLocation: estimatedLocation,
        confirmedAvailableDate: conf?.confirmed_date ?? null,
        confirmedAvailableLocation: conf?.confirmed_location ?? null,
        confirmedNotes: conf?.notes ?? null,
      }
    })

    return c.json({ data, meta: { count: data.length } })
  } catch (err) {
    logger.error('longhaul cloud driver-planning failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch driver planning',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
}
