// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /trips` (LIST) handler.
//
// Phase 3 of the longhaul strangler-fig migration: serves
// GET /api/v1/onprem/longhaul/trips from the cloud Hono Lambda instead of
// proxying it to the tenant's on-prem server. Mounted in app.ts ahead of the
// /onprem wildcard proxy so Hono route precedence routes /trips here while
// every un-migrated longhaul endpoint still falls through to the proxy.
//
// Round-trip discipline: the on-prem repository (findTripsWithQuery) makes
// TWO MSSQL round trips — one for the trips list (6 LEFT JOINs) and a second
// `SELECT * FROM TripNotes WHERE tripId IN (...)` to attach notes. This
// handler COLLAPSES the notes fetch into the main query via a correlated
// `FOR JSON PATH` subquery, so it makes exactly ONE round trip.
//
// The response shape matches the on-prem handler exactly:
// `{ data: [...trips], meta: { count } }`.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql, type SqlParam } from '../../lib/mssql-executor-client'
import { logger } from '../../lib/logger'

// ---------------------------------------------------------------------------
// Filter / sort query shapes — mirror TripQuery in trips.repository.ts.
//
// IMPORTANT (Phase 3.1): the UI puts the WHOLE TripQuery into the
// `?filters=...` URL param. See
// apps/tenant-web/src/features/driver-planning/utils/api/routes.ts which does
// `?filters=${encodeURIComponent(JSON.stringify(query))}` where `query` is
// `{ searchTerm, filters: {...}, sortBy: {...} }`. So the parsed JSON's
// `filters` is NESTED — not the top-level object. Reading it flat (as a
// previous version of this handler did) silently disabled every filter
// including `id`. The handler does NOT read a separate `?sortBy=` param —
// `sortBy` is nested inside the same JSON.
// ---------------------------------------------------------------------------

interface TripFilters {
  id?: string
  driver_id?: { label?: string; value?: string | number }
  // The state dropdown emits the raw `v_longhaul_states` row as `value`, whose
  // PK is `id` (no `state_id`). Older/legacy callers used `state_id`. Accept
  // either so a picked state actually filters. See buildWhere below.
  origin?: Array<{ value?: { state_id?: number; id?: number } }>
  destination?: Array<{ value?: { state_id?: number; id?: number } }>
  origin_zone?: Array<{ value?: string }>
  destination_zone?: Array<{ value?: string }>
  weight?: [number | null, number | null]
  planned_date?: [string | null, string | null]
  planned_start?: [string | null, string | null]
  planned_end?: [string | null, string | null]
  TripStatus_id?: Array<{ value?: string | number }>
  internal_status?: Array<{ value?: string }>
  planner_id?: Array<{ value?: string | number }>
  dispatcher_id?: Array<{ value?: string | number }>
}

interface TripSortBy {
  value?: string
  order?: string
}

/**
 * The actual JSON shape the UI URL-encodes into `?filters=`. Matches
 * `TripQuery` in repositories/longhaul/trips.repository.ts (which the on-prem
 * handler passes to findTripsWithQuery verbatim).
 */
interface TripQuery {
  searchTerm?: string
  filters?: TripFilters
  sortBy?: TripSortBy
}

// Columns that may be sorted on — whitelisted so `sortBy` can never inject
// SQL via an ORDER BY clause (column identifiers cannot be parameterized).
const SORTABLE_COLUMNS: Record<string, string> = {
  id: 'TripMaster.id',
  trip_title: 'TripMaster.trip_title',
  TripStatus_id: 'TripMaster.TripStatus_id',
  internal_status: 'TripMaster.internal_status',
  driver_id: 'TripMaster.driver_id',
  dispatcher_id: 'TripMaster.dispatcher_id',
  origin_state_id: 'TripMaster.origin_state_id',
  destination_state_id: 'TripMaster.destination_state_id',
  total_estimated_lbs: 'TripMaster.total_estimated_lbs',
  total_actual_lbs: 'TripMaster.total_actual_lbs',
  planned_first_day: 'TripMaster.planned_first_day',
  planned_last_day: 'TripMaster.planned_last_day',
  created_date: 'TripMaster.created_date',
}

// Base SELECT — mirrors findTripsWithQuery's 6 LEFT JOINs plus a correlated
// FOR JSON PATH subquery that inlines each trip's TripNotes rows. `notes` comes
// back as a JSON string per row; we parse it after the single round trip.
//
// The notes subquery carries INCLUDE_NULL_VALUES because FOR JSON drops
// NULL-valued keys by default, so a note's null columns would vanish rather than
// arrive as null. trip-fetch reads the same table with a plain SELECT and does
// return them; this keeps both routes' note shape identical. Same class as the
// "OA Committed?" coverage bug in #629.
const SELECT_AND_JOINS = `
  SELECT TOP (100)
    TripMaster.*,
    ts.status AS status_status,
    ts.status_id AS status_id,
    drv.driver_name,
    drv.agent_code,
    os.geo_code AS origin_geo_code,
    os.geo_name AS origin_geo_name,
    os.zone AS origin_zone_code,
    ds.geo_code AS destination_geo_code,
    ds.geo_name AS destination_geo_name,
    ds.zone AS destination_zone_code,
    pu.first_name AS planner_first_name,
    pu.last_name AS planner_last_name,
    du.first_name AS dispatcher_first_name,
    du.last_name AS dispatcher_last_name,
    (
      SELECT n.* FROM TripNotes n
      WHERE n.tripId = TripMaster.id
      FOR JSON PATH, INCLUDE_NULL_VALUES
    ) AS notes
  FROM TripMaster
  LEFT JOIN MasterTripStatus AS ts ON TripMaster.TripStatus_id = ts.status_id
  LEFT JOIN v_longhaul_drivers AS drv ON TripMaster.driver_id = drv.driver_id
  LEFT JOIN v_longhaul_states AS os ON TripMaster.origin_state_id = os.id
  LEFT JOIN v_longhaul_states AS ds ON TripMaster.destination_state_id = ds.id
  LEFT JOIN v_longhaul_salesman AS pu ON TripMaster.created_by_id = pu.code
  LEFT JOIN v_longhaul_salesman AS du ON TripMaster.dispatcher_id = du.code`

interface TripRow {
  id: number
  notes: string | null
  [key: string]: unknown
}

/**
 * Build the WHERE clause and bound parameters from the parsed filters. Every
 * user value binds as an `@name` parameter — never string-concatenated.
 */
function buildWhere(filters: TripFilters | undefined): {
  clause: string
  params: SqlParam[]
} {
  const conditions: string[] = []
  const params: SqlParam[] = []
  let i = 0
  const bind = (value: unknown): string => {
    const name = `p${i++}`
    params.push({ name, value })
    return `@${name}`
  }
  // Emit a `col IN (@a, @b, ...)` condition; skips empty value lists.
  const inClause = (col: string, values: unknown[]): void => {
    const cleaned = values.filter((v) => v !== undefined && v !== null && v !== '')
    if (cleaned.length === 0) return
    conditions.push(`${col} IN (${cleaned.map((v) => bind(v)).join(', ')})`)
  }

  if (!filters) return { clause: '', params }

  if (filters.id) {
    conditions.push(`TripMaster.id = ${bind(filters.id)}`)
  }

  if (filters.driver_id?.value !== undefined && filters.driver_id.value !== null) {
    conditions.push(`TripMaster.driver_id = ${bind(filters.driver_id.value)}`)
  }

  if (filters.origin?.length) {
    inClause(
      'TripMaster.origin_state_id',
      filters.origin.map((o) => o.value?.state_id ?? o.value?.id),
    )
  }

  if (filters.destination?.length) {
    inClause(
      'TripMaster.destination_state_id',
      filters.destination.map((d) => d.value?.state_id ?? d.value?.id),
    )
  }

  if (filters.origin_zone?.length) {
    inClause(
      'os.zone',
      filters.origin_zone.map((z) => z.value),
    )
  }

  if (filters.destination_zone?.length) {
    inClause(
      'ds.zone',
      filters.destination_zone.map((z) => z.value),
    )
  }

  if (filters.weight) {
    const [min, max] = filters.weight.map((v) => (v === null || v === undefined ? null : Number(v)))
    if (min != null) conditions.push(`TripMaster.total_estimated_lbs >= ${bind(min)}`)
    if (max != null) conditions.push(`TripMaster.total_estimated_lbs <= ${bind(max)}`)
  }

  if (filters.planned_date) {
    const [start, end] = filters.planned_date
    if (start && end) {
      conditions.push(`TripMaster.planned_first_day <= ${bind(end)}`)
      conditions.push(`TripMaster.planned_last_day >= ${bind(start)}`)
    } else if (end) {
      conditions.push(`NOT (TripMaster.planned_first_day > ${bind(end)})`)
    } else if (start) {
      conditions.push(`NOT (TripMaster.planned_last_day < ${bind(start)})`)
    }
  }

  if (filters.planned_start) {
    const [start, end] = filters.planned_start
    if (start && end) {
      conditions.push(`NOT (TripMaster.planned_first_day > ${bind(end)})`)
      conditions.push(`NOT (TripMaster.planned_first_day < ${bind(start)})`)
    } else if (end) {
      conditions.push(`NOT (TripMaster.planned_first_day > ${bind(end)})`)
    } else if (start) {
      conditions.push(`NOT (TripMaster.planned_first_day < ${bind(start)})`)
    }
  }

  if (filters.planned_end) {
    const [start, end] = filters.planned_end
    if (start && end) {
      conditions.push(`NOT (TripMaster.planned_last_day > ${bind(end)})`)
      conditions.push(`NOT (TripMaster.planned_last_day < ${bind(start)})`)
    } else if (end) {
      conditions.push(`NOT (TripMaster.planned_last_day > ${bind(end)})`)
    } else if (start) {
      conditions.push(`NOT (TripMaster.planned_last_day < ${bind(start)})`)
    }
  }

  if (filters.TripStatus_id?.length) {
    inClause(
      'TripMaster.TripStatus_id',
      filters.TripStatus_id.map((s) => s.value),
    )
  }

  if (filters.internal_status?.length) {
    inClause(
      'TripMaster.internal_status',
      filters.internal_status.map((s) => s.value),
    )
  }

  if (filters.planner_id?.length) {
    inClause(
      'TripMaster.created_by_id',
      filters.planner_id.map((p) => p.value),
    )
  }

  if (filters.dispatcher_id?.length) {
    inClause(
      'TripMaster.dispatcher_id',
      filters.dispatcher_id.map((d) => d.value),
    )
  }

  return {
    clause: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '',
    params,
  }
}

/** Build the ORDER BY clause from a whitelisted `sortBy` value, or '' if absent. */
function buildOrderBy(sortBy: TripSortBy | undefined): string {
  if (!sortBy?.order || !sortBy.value) return ''
  const column = SORTABLE_COLUMNS[sortBy.value]
  if (!column) return ''
  const direction = sortBy.order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
  return ` ORDER BY ${column} ${direction}`
}

export const longhaulTripsListHandler: Handler<AppEnv> = async (c) => {
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

  // The UI URL-encodes the whole TripQuery into `?filters=` — see header
  // comment. We JSON.parse it once and read `.filters` / `.sortBy` from
  // there. The on-prem handler does the same thing via findTripsWithQuery.
  let query: TripQuery = {}
  const rawFilters = c.req.query('filters')
  if (rawFilters) {
    try {
      query = JSON.parse(rawFilters) as TripQuery
    } catch {
      return c.json(
        {
          error: 'Invalid filters JSON',
          code: 'VALIDATION_ERROR',
          correlationId: c.get('correlationId'),
        },
        400,
      )
    }
  }

  const { clause, params } = buildWhere(query.filters)
  const orderBy = buildOrderBy(query.sortBy)
  const sql = `${SELECT_AND_JOINS}${clause}${orderBy}`

  try {
    const { recordset } = await executeSql(tenant.mssqlConnectionString, sql, { params })
    const rows = recordset as TripRow[]
    // The `notes` column is a JSON string (FOR JSON PATH) or NULL when the
    // trip has no notes — normalize to an array, mirroring the on-prem shape.
    const data = rows.map((row) => {
      const { notes, ...trip } = row
      return {
        ...trip,
        notes: notes ? (JSON.parse(notes) as unknown[]) : [],
      }
    })
    return c.json({ data, meta: { count: data.length } })
  } catch (err) {
    logger.error('longhaul cloud trips list failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch trips',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
}
