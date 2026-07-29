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
// dropped in favor of a SECOND query that pulls EVERY RDEL (delivery) activity
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
import { availabilityDriverFilter } from './driver-filter'
import { ENSURE_CONFIRMED_TABLE_SQL } from './driver-confirmed-availability-schema'

// One round trip: every driver and its latest non-cancelled trip.
// v_longhaul_drivers exposes UPPERCASE columns on the Dolios SQL Server — alias
// them to lowercase exactly as the on-prem `lowercaseRowKeys` normalization
// does, so downstream code sees `driver_id` etc.
//
// The WHERE clause hides the 99994-99999 placeholder rows on top of the
// active-only filter (see ./driver-filter). This card renders one row per
// driver with no search, so it is stricter than the Planning driver dropdown,
// which lists every active driver.
const PLANNING_SQL = `
SELECT
  d.DRIVER_ID   AS driver_id,
  d.DRIVER_NAME AS driver_name,
  d.AGENT_CODE  AS agent_code,
  d.is_local_drv     AS is_local_drv,
  d.is_long_dist_drv AS is_long_dist_drv,
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
WHERE ${availabilityDriverFilter('d')}
`

// Second round trip — TWO recordsets in one batch:
//   [0] every RDEL (delivery) activity for the latest-trip set (legacy shape,
//       consumed by Variants B/C and by the back-compat
//       estimatedAvailableDate/Location summary).
//   [1] one row per (trip, shipment) — the chronologically FINAL activity on
//       each shipment, irrespective of activity type. Variant A renders this
//       to show one row per shipment with dates from the final activity.
// The IN-list is interpolated from the trip_id values returned by PLANNING_SQL;
// they're integers we just read back from the DB, so direct interpolation is
// safe here. Skipped entirely when no driver has a current trip.
function buildDeliveriesSql(tripIds: number[]): string {
  const inList = tripIds.join(',')
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
  AND la.TripMaster_id IN (${inList});

WITH ranked AS (
  SELECT
    la.TripMaster_id AS trip_id,
    la.order_num     AS order_num,
    la.id            AS activity_id,
    la.planned_start AS planned_start,
    la.planned_end   AS planned_end,
    la.estimated_date AS estimated_date,
    la.actual_date   AS actual_date,
    la.is_committed  AS is_committed,
    la.is_confirmed  AS is_confirmed,
    la.city          AS city,
    la.state         AS state,
    ROW_NUMBER() OVER (
      PARTITION BY la.TripMaster_id, la.order_num
      ORDER BY COALESCE(la.actual_date, la.estimated_date, la.planned_end, la.planned_start) DESC,
               la.id DESC
    ) AS rn
  FROM LongDistanceDispatchActivity la
  WHERE la.TripMaster_id IN (${inList})
    AND la.order_num IS NOT NULL
)
SELECT trip_id, order_num, activity_id, planned_start, planned_end,
       estimated_date, actual_date, is_committed, is_confirmed, city, state
FROM ranked WHERE rn = 1;
`
}

// Third round trip — reads every override from DriverConfirmedAvailability.
// Must be preceded by ENSURE_CONFIRMED_TABLE_SQL in a SEPARATE call, not
// concatenated into the same batch: SQL Server resolves column references at
// parse time, so referencing home_state/rating/etc. in the SELECT before the
// ALTER TABLE ADD … in the same batch raises `Invalid column name` on tenants
// whose table predates those columns. Splitting the calls lets the ALTER
// commit before this SELECT is parsed. Still wrapped in a soft-fail
// try/catch by the caller for genuinely-absent tables on M2M-only tenants.
const CONFIRMED_SQL = `
SELECT driver_id, confirmed_date, confirmed_location, notes,
       canada, california, rating, equipment, home_city, home_state, wgs
FROM DriverConfirmedAvailability
`

interface PlanningRow {
  driver_id: number
  driver_name: string
  agent_code: string | null
  // v_longhaul_drivers move-type flags, stored as 'Y' / 'N' (uppercase).
  is_local_drv: string | null
  is_long_dist_drv: string | null
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

/** One row per (trip, shipment) — see buildDeliveriesSql recordset [1]. */
interface ShipmentRow extends DeliveryRow {
  order_num: number
}

interface ConfirmedRow {
  driver_id: number
  confirmed_date: string | null
  confirmed_location: string | null
  notes: string | null
  canada: boolean | number | null
  california: boolean | number | null
  rating: number | null
  equipment: string | null
  home_city: string | null
  home_state: string | null
  wgs: boolean | number | null
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

/** Same shape as Delivery plus the shipment FK. */
interface Shipment extends Delivery {
  orderNum: number
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
  canada: boolean
  california: boolean
  rating: number | null
  equipment: string | null
  homeCity: string | null
  homeState: string | null
  /** Tri-state: true = Yes, false = No, null = Maybe (the unset default). */
  wgs: boolean | null
  /** Handles local moves (v_longhaul_drivers.is_local_drv = 'Y'). */
  isLocal: boolean
  /** Handles long-distance moves (v_longhaul_drivers.is_long_dist_drv = 'Y'). */
  isLongDistance: boolean
  deliveries: Delivery[]
  shipments: Shipment[]
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

/** MSSQL bit may surface as boolean | 0 | 1 | null — normalize to boolean. */
function toBool(v: boolean | number | null | undefined): boolean {
  return v === true || v === 1
}

/** v_longhaul_drivers stores move-type flags as 'Y' / 'N' (uppercase). Treat
 *  'Y' (case-insensitively, trimmed) as true; anything else — including NULL — as false. */
function toYnBool(v: string | null | undefined): boolean {
  return (v ?? '').trim().toUpperCase() === 'Y'
}

/** Tri-state bit: 1/true = Yes, 0/false = No, NULL/absent = Maybe. Unlike
 *  `toBool`, NULL is preserved (the "Maybe" state) rather than coerced to No. */
function toTriBool(v: boolean | number | null | undefined): boolean | null {
  if (v === true || v === 1) return true
  if (v === false || v === 0) return false
  return null
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

    // Round trip 2 — RDEL deliveries AND final-activity-per-shipment for every
    // trip in the planning set, fetched as a single 2-statement batch. Skipped
    // entirely when no driver has a current trip.
    const tripIds = rows.map((r) => r.trip_id).filter((id): id is number => typeof id === 'number')
    const deliveriesByTrip = new Map<number, Delivery[]>()
    const shipmentsByTrip = new Map<number, Shipment[]>()
    if (tripIds.length > 0) {
      const batch = await executeSql(connectionString, buildDeliveriesSql(tripIds))
      // Defensive: a single-statement executor response (legacy / mocked) only
      // sets `recordset`; treat it as the deliveries recordset with no
      // shipments. The wrapper normally populates `recordsets` itself.
      const sets: unknown[][] =
        Array.isArray(batch.recordsets) && batch.recordsets.length > 0
          ? batch.recordsets
          : batch.recordset
            ? [batch.recordset]
            : []
      const deliveryRows = (sets[0] ?? []) as DeliveryRow[]
      const shipmentRows = (sets[1] ?? []) as ShipmentRow[]

      for (const row of deliveryRows) {
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

      for (const row of shipmentRows) {
        const shipment: Shipment = {
          orderNum: row.order_num,
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
        const bucket = shipmentsByTrip.get(row.trip_id)
        if (bucket) {
          bucket.push(shipment)
        } else {
          shipmentsByTrip.set(row.trip_id, [shipment])
        }
      }
      // Same effective-date sort as deliveries so the rendering order is stable.
      for (const [tripId, bucket] of shipmentsByTrip) {
        shipmentsByTrip.set(tripId, sortDeliveries(bucket) as Shipment[])
      }
    }

    // Round trip 3 — Confirmed-availability overrides. The schema-ensure
    // (CREATE-if-missing + ALTER-ADD-column guards) MUST run as its own batch
    // so SQL Server parse-time column resolution doesn't reject the SELECT on
    // tenants whose table predates the Variant-B roster columns. Both calls
    // are wrapped in a single soft-fail try/catch — if either fails, the
    // override set is treated as empty so the planning grid still renders.
    const confirmedByDriver = new Map<number, ConfirmedRow>()
    try {
      await executeSql(connectionString, ENSURE_CONFIRMED_TABLE_SQL)
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
      const shipments = row.trip_id != null ? (shipmentsByTrip.get(row.trip_id) ?? []) : []

      // Calculated availability date / location: the chronologically FINAL
      // activity on the driver's latest trip — i.e. the last shipment's
      // final-activity row (any activity type, not just RDEL). Both arrays are
      // sorted ascending by effective date, so the last element is the latest.
      // Falls back to the last RDEL delivery, then to the trip's planned/actual
      // last day + destination_geo_name when no activities are available.
      const lastShipment = shipments[shipments.length - 1]
      const lastDelivery = deliveries[deliveries.length - 1]
      const lastActivity = lastShipment ?? lastDelivery
      const estimatedDate =
        lastActivity?.actualDate ??
        lastActivity?.estimatedDate ??
        lastActivity?.plannedEnd ??
        row.planned_last_day ??
        row.actual_last_day ??
        null

      const lastCity = lastActivity?.city ?? null
      const lastState = lastActivity?.state ?? null
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
        canada: toBool(conf?.canada),
        california: toBool(conf?.california),
        rating: conf?.rating ?? null,
        equipment: conf?.equipment ?? null,
        homeCity: conf?.home_city ?? null,
        homeState: conf?.home_state ?? null,
        wgs: toTriBool(conf?.wgs),
        isLocal: toYnBool(row.is_local_drv),
        isLongDistance: toYnBool(row.is_long_dist_drv),
        deliveries,
        shipments,
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
