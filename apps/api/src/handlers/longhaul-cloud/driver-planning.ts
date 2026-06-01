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
// This handler collapses (1)-(2) into ONE query: v_longhaul_drivers LEFT JOINed
// to its latest trip via OUTER APPLY (TOP 1). The "last activity" subquery was
// dropped in favour of a SECOND query that pulls EVERY RDEL (delivery) activity
// for the latest-trip set in one shot, so the Operations → Availability UI can
// stack a row per delivery on each driver's card. The DriverConfirmedAvailability
// lookup is a THIRD query that soft-fails (caught + treated as empty) exactly
// as the on-prem repo does when the table is absent on a tenant. Target: 1-3
// round trips (planning + optional deliveries + optional confirmed). Response
// shape — `{ data, meta }` — matches the on-prem handler and adds a
// `deliveries: Delivery[]` array per driver.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'
import { logger } from '../../lib/logger'
import { longhaulDriverFilter } from './driver-filter'

// One round trip: every driver and its latest non-cancelled trip.
// v_longhaul_drivers exposes UPPERCASE columns on the Dolios SQL Server — alias
// them to lowercase exactly as the on-prem `lowercaseRowKeys` normalisation
// does, so downstream code sees `driver_id` etc.
//
// The WHERE clause keeps this list in lockstep with the Planning driver
// dropdown (see ./driver-filter) — active, real drivers only.
const PLANNING_SQL = `
SELECT
  d.DRIVER_ID   AS driver_id,
  d.DRIVER_NAME AS driver_name,
  d.AGENT_CODE  AS agent_code,
  t.id            AS trip_id,
  t.trip_title    AS trip_title,
  t.planned_last_day AS planned_last_day,
  t.actual_last_day  AS actual_last_day,
  t.destination_geo_name AS destination_geo_name
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
WHERE ${longhaulDriverFilter('d')}
`

// Second round trip — every RDEL (delivery) activity for the latest-trip set.
// The IN-list is interpolated from the trip_id values returned by PLANNING_SQL;
// they're integers we just read back from the DB, so direct interpolation is
// safe here. Skipped entirely when no driver has a current trip.
function buildDeliveriesSql(tripIds: number[]): string {
  return `
SELECT
  la.TripMaster_id AS trip_id,
  la.id            AS activity_id,
  la.planned_start AS planned_start,
  la.planned_end   AS planned_end,
  la.estimated_date AS estimated_date,
  la.actual_date   AS actual_date,
  la.is_committed  AS is_committed,
  la.is_confirmed  AS is_confirmed,
  la.city          AS city,
  la.state         AS state
FROM LongDistanceDispatchActivity la
WHERE la.ActivityType_code = 'RDEL'
  AND la.TripMaster_id IN (${tripIds.join(',')})
`
}

// Third round trip — soft-fails when DriverConfirmedAvailability is absent.
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
}

interface DeliveryRow {
  trip_id: number
  activity_id: number
  planned_start: string | null
  planned_end: string | null
  estimated_date: string | null
  actual_date: string | null
  is_committed: boolean | number | null
  is_confirmed: boolean | number | null
  city: string | null
  state: string | null
}

interface ConfirmedRow {
  driver_id: number
  confirmed_date: string | null
  confirmed_location: string | null
  notes: string | null
}

interface Delivery {
  activityId: number
  plannedStart: string | null
  plannedEnd: string | null
  estimatedDate: string | null
  actualDate: string | null
  isCommitted: boolean
  isConfirmed: boolean
  city: string | null
  state: string | null
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
  deliveries: Delivery[]
}

/** Mirrors features/driver-planning/containers/Trip/utils/sort-activities.ts.
 * Sort by effective date (actual ?? estimated ?? planned_start), then planned_end. */
function sortDeliveries(deliveries: Delivery[]): Delivery[] {
  return deliveries.slice().sort((a, b) => {
    if (!a.plannedEnd) return 1
    if (!b.plannedEnd) return -1
    const aKey = a.actualDate ?? a.estimatedDate ?? a.plannedStart
    const bKey = b.actualDate ?? b.estimatedDate ?? b.plannedStart
    const diff = +new Date(aKey as string) - +new Date(bKey as string)
    if (diff !== 0) return diff
    return +new Date(a.plannedEnd) - +new Date(b.plannedEnd)
  })
}

/** MSSQL bit may surface as boolean | 0 | 1 | null — normalise to boolean. */
function toBool(v: boolean | number | null | undefined): boolean {
  return v === true || v === 1
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

    // Round trip 2 — RDEL deliveries for every trip in the planning set. Skip
    // entirely when no driver has a current trip.
    const tripIds = rows.map((r) => r.trip_id).filter((id): id is number => typeof id === 'number')
    const deliveriesByTrip = new Map<number, Delivery[]>()
    if (tripIds.length > 0) {
      const { recordset: deliveryRows } = await executeSql(
        connectionString,
        buildDeliveriesSql(tripIds),
      )
      for (const row of deliveryRows as DeliveryRow[]) {
        const delivery: Delivery = {
          activityId: row.activity_id,
          plannedStart: row.planned_start ?? null,
          plannedEnd: row.planned_end ?? null,
          estimatedDate: row.estimated_date ?? null,
          actualDate: row.actual_date ?? null,
          isCommitted: toBool(row.is_committed),
          isConfirmed: toBool(row.is_confirmed),
          city: row.city ?? null,
          state: row.state ?? null,
        }
        const bucket = deliveriesByTrip.get(row.trip_id)
        if (bucket) {
          bucket.push(delivery)
        } else {
          deliveriesByTrip.set(row.trip_id, [delivery])
        }
      }
      // Sort each bucket in place once.
      for (const [tripId, bucket] of deliveriesByTrip) {
        deliveriesByTrip.set(tripId, sortDeliveries(bucket))
      }
    }

    // Round trip 3 — Confirmed-availability overrides. Optional; the
    // DriverConfirmedAvailability table may not exist on a given tenant, so we
    // catch the query error and treat the override set as empty.
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
      const deliveries = row.trip_id != null ? (deliveriesByTrip.get(row.trip_id) ?? []) : []

      // For back-compat, derive a single estimated date + location from the
      // LAST delivery (highest effective date after sortDeliveries) so existing
      // consumers of estimatedAvailableDate/Location keep working. Fall back to
      // the trip's planned/actual last day and destination_geo_name when there
      // are no deliveries.
      const lastDelivery = deliveries[deliveries.length - 1]
      const estimatedDate =
        lastDelivery?.actualDate ??
        lastDelivery?.estimatedDate ??
        lastDelivery?.plannedEnd ??
        row.planned_last_day ??
        row.actual_last_day ??
        null

      const lastCity = lastDelivery?.city ?? null
      const lastState = lastDelivery?.state ?? null
      const estimatedLocation =
        lastCity && lastState
          ? `${lastCity}, ${lastState}`
          : (lastCity ?? lastState ?? row.destination_geo_name ?? null)

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
        deliveries,
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
