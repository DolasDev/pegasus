// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /shipments` LIST handler.
//
// Phase 3 of the longhaul strangler-fig migration: serves
// GET /api/v1/onprem/longhaul/shipments from the cloud Hono Lambda instead of
// proxying it to the tenant's on-prem server. Mounted in app.ts ahead of the
// /onprem wildcard proxy so Hono route precedence routes /shipments here while
// every un-migrated longhaul endpoint still falls through to the proxy.
//
// Semantics are a faithful port of the on-prem handler
// (handlers/longhaul/shipments.ts) + repository
// (repositories/longhaul/shipments.repository.ts):
//   - base query against v_longhaul_shipments_v2 with the same searchTerm
//     behavior, filter set, ordering, and 1001-row base cap;
//   - per-row JS enrichment: getTripInfo trip-info merge, the post-fetch
//     TripStatus_id filter, buildShipmentActivities (required PACK/LOAD-or-R19O/
//     RDEL templates), buildExtraShipmentActivities (optional extras);
//   - hard 1000-row response limit → 400 RESULT_LIMIT_EXCEEDED;
//   - response shape `{ data, meta: { count } }`.
//
// Round-trip reduction: the on-prem repo fans out into 5 MSSQL round trips
// (base query, activities, coverage, extra_locations, activity-types map).
// This handler collapses that into 3 — and runs trips 2 + 3 concurrently:
//   1. base shipments query;
//   2. ONE combined enrichment query — activities + coverage + activity-types
//      catalog UNION ALL'd into a single recordset tagged with `__src`;
//   3. extra_locations (kept separate because the table may not exist on every
//      tenant — it is soft-failed exactly as on-prem does).
//
// One shipment = one row. The on-prem query reached `sales` and the origin /
// destination state rows through LEFT JOINs on non-key columns, so a shipment
// whose order had two `sales` rows — or whose state code appeared twice in
// v_longhaul_states — came back duplicated in the planning list. The joins are
// gone: `sales` is read through a TOP (1) OUTER APPLY, the zone filters run as
// EXISTS, and dedupeByOrderNum backstops the view itself.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql, type SqlParam } from '../../lib/mssql-executor-client'
import { logger } from '../../lib/logger'
import { getLonghaulClientConfigFor } from '../../lib/longhaul-client-config'
import {
  enrichShipmentWithTripInfo,
  buildExtraShipmentActivities,
  dedupeByOrderNum,
  type ShipmentRow,
  type ActivityRow,
  type ActivityType,
  type ExtraLocationRow,
} from '../../lib/longhaul-shipment-enrich'
import { buildShipmentActivities } from '../../lib/longhaul-build-activities'

// Mirrors the legacy guard in shipment.service.ts:57-58.
const SHIPMENT_RESULT_LIMIT = 1000
// One more than SHIPMENT_RESULT_LIMIT so the handler still returns its 400
// "narrow your filters" response — see shipments.repository BASE_QUERY_ROW_CAP.
const BASE_QUERY_ROW_CAP = 1001

const SHIPMENTS_TABLE = 'v_longhaul_shipments_v2'

interface ShipmentFilters {
  order_num?: Array<{ value: unknown }>
  origin?: Array<{ value: string }>
  destination?: Array<{ value: string }>
  origin_zone?: Array<{ value: string }>
  destination_zone?: Array<{ value: string }>
  operations_id?: Array<{ value: string }>
  weight?: [number | null, number | null]
  mileage?: [number | null, number | null]
  pack_date?: [string | null, string | null]
  load_date?: [string | null, string | null]
  delivery_date?: [string | null, string | null]
  short_haul?: Array<{ value: string }>
  move_type?: Array<{ value: string }>
  assigned?: Array<{ value: string }>
  shaul?: Array<{ value: string }>
  TripStatus_id?: Array<{ value: string | number }>
  Is_Trip_Planning?: boolean
}

interface ShipmentQuery {
  searchTerm?: string
  filters?: ShipmentFilters
  sortBy?: { value: string; order: string }
}

/** Accumulates `WHERE` clauses + bound params while building the base query. */
class ParamBag {
  readonly params: SqlParam[] = []
  private seq = 0
  /** Bind a value, returning the `@name` placeholder to splice into SQL. */
  bind(value: unknown): string {
    const name = `p${this.seq++}`
    this.params.push({ name, value })
    return `@${name}`
  }
}

// ---------------------------------------------------------------------------
// Base query builder — mirrors findShipmentsWithQuery in the on-prem repo.
// ---------------------------------------------------------------------------

function buildBaseSql(query: ShipmentQuery, bag: ParamBag, importExportTypes: string[]): string {
  const S = SHIPMENTS_TABLE
  const where: string[] = []
  // Set by the move_type filter; read by the Is_Trip_Planning block, which runs
  // after it. Both constrain `import_export`, and an explicit selection wins.
  let moveTypeFiltered = false

  if (query.searchTerm && query.searchTerm.length >= 3) {
    const term = query.searchTerm.toLowerCase()
    const prefix = bag.bind(`${term}%`)
    const contains = bag.bind(`%${term}%`)
    const avl = bag.bind(`${term}%`)
    where.push(
      `(CAST(${S}.order_num AS varchar) LIKE ${prefix}` +
        ` OR LOWER(${S}.shipper_name) LIKE ${contains}` +
        ` OR LOWER(${S}.avl_reg) LIKE ${avl})`,
    )
  } else if (query.filters) {
    const f = query.filters

    if (f.order_num?.length) {
      const nums = f.order_num.map((o) => o.value).filter(Boolean)
      if (nums.length) {
        where.push(`${S}.order_num IN (${nums.map((n) => bag.bind(n)).join(', ')})`)
      }
    }

    if (f.origin?.length) {
      const vals = f.origin.map((o) => o.value).filter(Boolean)
      if (vals.length) {
        where.push(`${S}.shipper_state IN (${vals.map((v) => bag.bind(v)).join(', ')})`)
      }
    }

    if (f.destination?.length) {
      const vals = f.destination.map((d) => d.value).filter(Boolean)
      if (vals.length) {
        where.push(`${S}.consignee_state IN (${vals.map((v) => bag.bind(v)).join(', ')})`)
      }
    }

    // Zone predicates run as EXISTS rather than through a join. `geo_code` is
    // not a key of v_longhaul_states, so joining on it multiplied a shipment by
    // however many state rows shared its code — the duplicate-row bug on the
    // planning list. (Every other v_longhaul_states join in the codebase is on
    // the `id` key; this was the sole geo_code join.) EXISTS asks the same
    // question — "is any state row for this shipment's state in the selected
    // zones?" — without multiplying rows, and needs no join at all when the
    // filter is unset.
    if (f.origin_zone?.length) {
      const vals = f.origin_zone.map((z) => z.value).filter(Boolean)
      if (vals.length) {
        where.push(
          `EXISTS (SELECT 1 FROM v_longhaul_states AS os` +
            ` WHERE os.geo_code = ${S}.shipper_state` +
            ` AND os.zone IN (${vals.map((v) => bag.bind(v)).join(', ')}))`,
        )
      }
    }

    if (f.destination_zone?.length) {
      const vals = f.destination_zone.map((z) => z.value).filter(Boolean)
      if (vals.length) {
        where.push(
          `EXISTS (SELECT 1 FROM v_longhaul_states AS ds` +
            ` WHERE ds.geo_code = ${S}.consignee_state` +
            ` AND ds.zone IN (${vals.map((v) => bag.bind(v)).join(', ')}))`,
        )
      }
    }

    if (f.operations_id?.length) {
      const vals = f.operations_id.map((o) => o.value).filter(Boolean)
      if (vals.length) {
        where.push(`ps.operations_id IN (${vals.map((v) => bag.bind(v)).join(', ')})`)
      }
    }

    if (f.weight) {
      const [min, max] = f.weight.map((v) => (v ? Number(v) : null))
      if (min != null) where.push(`${S}.total_est_wt >= ${bag.bind(min)}`)
      if (max != null) where.push(`${S}.total_est_wt <= ${bag.bind(max)}`)
    }

    if (f.mileage) {
      const [min, max] = f.mileage.map((v) => (v ? Number(v) : null))
      if (min != null) where.push(`${S}.mileage >= ${bag.bind(min)}`)
      if (max != null) where.push(`${S}.mileage <= ${bag.bind(max)}`)
    }

    // Each date filter compares a planned column and an actual column; the
    // `(start && end)` / end-only / start-only branching mirrors the on-prem
    // repo (findShipmentsWithQuery) verbatim.
    const dateRangeClause = (
      range: [string | null, string | null],
      planCol: string,
      actualCol: string,
    ): void => {
      const [start, end] = range
      if (start && end) {
        where.push(
          `((${S}.${planCol} BETWEEN ${bag.bind(start)} AND ${bag.bind(end)})` +
            ` OR (${S}.${actualCol} BETWEEN ${bag.bind(start)} AND ${bag.bind(end)}))`,
        )
      } else if (end) {
        where.push(`NOT (${S}.${planCol} > ${bag.bind(end)})`)
      } else if (start) {
        where.push(`NOT (${S}.${actualCol} < ${bag.bind(start)})`)
      }
    }

    if (f.pack_date) dateRangeClause(f.pack_date, 'plan_pack', 'pack_date2')
    if (f.load_date) dateRangeClause(f.load_date, 'plan_load', 'load_date2')
    if (f.delivery_date) dateRangeClause(f.delivery_date, 'plan_del', 'del_date2')

    if (f.short_haul?.length) {
      const vals = f.short_haul.map((s) => s.value).filter(Boolean)
      if (vals.length) {
        where.push(`${S}.haul_mode IN (${vals.map((v) => bag.bind(v)).join(', ')})`)
      }
    }

    // `move_type` has no column of its own — it filters `import_export`, the
    // very column the Is_Trip_Planning whitelist below also constrains. When the
    // user picks a code the whitelist omits, ANDing the two yields an
    // unsatisfiable conjunction and an empty list with nothing to say why. So an
    // explicit selection SUPERSEDES the whitelist rather than intersecting with
    // it (see the Is_Trip_Planning block).
    if (f.move_type?.length) {
      const vals = f.move_type.map((m) => m.value).filter(Boolean)
      if (vals.length) {
        moveTypeFiltered = true
        where.push(`${S}.import_export IN (${vals.map((v) => bag.bind(v)).join(', ')})`)
      }
    }

    if (f.assigned?.length === 1) {
      const val = f.assigned[0]?.value ?? ''
      if (val.includes('No')) {
        where.push(`(${S}.driver_id = ${bag.bind('0')} OR ${S}.driver_id IS NULL)`)
      } else if (val.includes('Yes')) {
        where.push(
          `${S}.driver_id IN (SELECT driver_id FROM v_longhaul_drivers WHERE driver_id <> 0)`,
        )
      }
    }

    if (f.shaul?.length) {
      const vals = f.shaul.map((s) => s.value).filter(Boolean)
      if (vals.length) {
        where.push(`${S}.shaul IN (${vals.map((v) => bag.bind(v)).join(', ')})`)
      }
    }

    if (f.Is_Trip_Planning) {
      where.push(`${S}.shipment_status = ${bag.bind('A')}`)
      // The whitelist is the DEFAULT eligibility set, not an absolute bound: it
      // decides which codes appear when the user has expressed no preference.
      // An explicit move_type selection IS that preference, so it wins — the
      // user asked for those codes by name, and the dropdown (built from the
      // MoveType lookup, `1=1` for NWI) offers all 16 of them. Suppressing the
      // whitelist here is what makes the other 10 reachable; intersecting
      // instead is what made them silently return zero rows.
      //
      // Deliberately NOT widened to include those codes by default: this same
      // predicate gates the unfiltered planning list, and admitting them there
      // would take it from ~15.9k to ~43.6k eligible rows (prod NWI), burying
      // central dispatchers in LOCAL MOVES / PERM STORAGE and blowing the
      // RESULT_LIMIT cap. Which codes also belong in the DEFAULT set is a
      // separate, per-code operations decision.
      //
      // The other two predicates are unconditional — an explicit move-type
      // filter says nothing about wanting cancelled or already-delivered work.
      if (!moveTypeFiltered) {
        where.push(
          `${S}.import_export IN (${importExportTypes.map((t) => bag.bind(t)).join(', ')})`,
        )
      }
      where.push(`${S}.del_actual IS NULL`)
    }
  }

  // Ordering — mirrors the repo: a caller-supplied sortBy, else plan_load asc.
  let orderBy: string
  if (query.sortBy?.order) {
    const col = query.sortBy.value
    const dir = query.sortBy.order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
    orderBy = `${S}.${col} ${dir}, ${S}.shipper_name ASC`
  } else {
    orderBy = `${S}.plan_load ASC, ${S}.shipper_name ASC`
  }

  const whereSql = where.length ? `\nWHERE ${where.join('\n  AND ')}` : ''
  // TOP enforces the base-query row cap (mssql has no LIMIT).
  return (
    // NOTE: every shadow column must be aliased to a name the view does NOT
    // already project. `s.*` is 91 columns wide; when an OUTER APPLY column
    // repeats one of those names the row arrives with that key bound to an
    // ARRAY of both values (`operations_id: [1196, 1196]`), not a scalar —
    // the mssql driver's duplicate-column behavior. `operations_id` did
    // exactly that until it was dropped here: the view already projects
    // `sales.operations_id`, the very column the OUTER APPLY re-read, so the
    // second copy was redundant as well as corrupting. `operations_name` has
    // no counterpart on the view, so it still has to come from the apply.
    `SELECT TOP (${BASE_QUERY_ROW_CAP}) ${S}.*,` +
    `\n  ps.weight AS shadow_weight,` +
    `\n  ps.lng_dis_comments AS shadow_comments,` +
    `\n  ps.operations_name AS operations_name` +
    `\nFROM ${S}` +
    // OUTER APPLY, not LEFT JOIN: `sales` is 1:1 with a shipment by contract
    // (shipments-write.ts guards its INSERT with IF NOT EXISTS) but nothing in
    // the schema enforces it, and a second row silently duplicated the shipment
    // in the list. TOP (1) caps the contribution at one row per shipment while
    // keeping the same four shadow columns and LEFT-JOIN null semantics. There
    // is no tiebreaker column to order by — this is a fan-out guard, not a
    // selection strategy; with the 1:1 contract held there is only ever one row.
    `\nOUTER APPLY (` +
    `\n  SELECT TOP (1) sal.weight, sal.lng_dis_comments, sal.operations_id, sal.operations_name` +
    `\n  FROM sales AS sal WHERE sal.order_num = ${S}.order_num` +
    `\n) AS ps` +
    whereSql +
    `\nORDER BY ${orderBy}`
  )
}

// ---------------------------------------------------------------------------
// Combined enrichment query — collapses the on-prem activities + coverage +
// activity-types fan-out (3 separate round trips) into ONE UNION ALL recordset.
// Each row carries a `__src` discriminator: 'activity' | 'coverage' | 'type'.
// All payload columns are JSON-serialized into `__payload` so heterogeneous
// shapes coexist in one result set.
// ---------------------------------------------------------------------------

function buildEnrichmentSql(orderNums: number[], bag: ParamBag): string {
  const placeholders = orderNums.map((n) => bag.bind(n)).join(', ')
  return (
    `SELECT 'activity' AS __src,` +
    ` lda.order_num AS __order_num,` +
    ` (SELECT lda.*,` +
    `   at.code AS activityType_code,` +
    `   at.name AS activityType_name,` +
    `   at.abbreviation AS activityType_abbreviation,` +
    `   at.isCanEditDates AS activityType_isCanEditDates,` +
    `   at.isHasETA AS activityType_isHasETA,` +
    `   drv.driver_name AS driver_name` +
    // INCLUDE_NULL_VALUES on all three payloads below: FOR JSON omits
    // NULL-valued keys by default, which is what made an unset "OA Committed?"
    // read back as `undefined` (#629). Today's activity consumers all happen to
    // be null/undefined-agnostic, so this is a landmine rather than a live bug —
    // but the SAME table read via trip-detail (longhaul-trip-fetch, a plain
    // SELECT) already returns explicit nulls, so one activity object had
    // different key presence depending on which route loaded it. This converges
    // the two; it is not a new input shape for any consumer.
    `  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES) AS __payload` +
    ` FROM LongDistanceDispatchActivity AS lda` +
    ` LEFT JOIN Longhaul_ActivityType AS at ON lda.ActivityType_code = at.code` +
    ` LEFT JOIN v_longhaul_drivers AS drv ON lda.assigned_driver_id = drv.driver_id` +
    ` WHERE lda.order_num IN (${placeholders})` +
    `\nUNION ALL\n` +
    `SELECT 'coverage' AS __src,` +
    ` cov.order_num AS __order_num,` +
    // INCLUDE_NULL_VALUES is REQUIRED here: FOR JSON omits NULL-valued keys by
    // default, so a coverage row with `is_covered IS NULL` (the "OA Committed?"
    // unset state — 2.3k rows on NWI alone) arrived with no `is_covered` key at
    // all. The client then read `undefined`, failed its `=== null` check, and
    // rendered the unset state as "No". The trip-detail route never hit this
    // because it reads the same table with a plain SELECT (longhaul-trip-fetch).
    ` (SELECT cov.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES) AS __payload` +
    ` FROM longhaul_shipmentcoverage AS cov` +
    ` WHERE cov.order_num IN (${placeholders})` +
    `\nUNION ALL\n` +
    `SELECT 'type' AS __src,` +
    ` NULL AS __order_num,` +
    ` (SELECT t.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES) AS __payload` +
    ` FROM Longhaul_ActivityType AS t`
  )
}

interface EnrichmentRow {
  __src: 'activity' | 'coverage' | 'type'
  __order_num: number | null
  __payload: string | null
}

function parsePayload(row: EnrichmentRow): Record<string, unknown> | null {
  if (!row.__payload) return null
  try {
    return JSON.parse(row.__payload) as Record<string, unknown>
  } catch {
    return null
  }
}

// Extra-locations query — kept separate from the enrichment UNION because the
// pegasus_extra_location table is absent on some tenants; on-prem soft-fails it.
function buildExtraLocationsSql(orderNums: number[], bag: ParamBag): string {
  const placeholders = orderNums.map((n) => bag.bind(n)).join(', ')
  return `SELECT * FROM pegasus_extra_location WHERE order_num IN (${placeholders})`
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const longhaulShipmentsListHandler: Handler<AppEnv> = async (c) => {
  const tenantId = c.get('tenantId')
  const correlationId = c.get('correlationId')

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { mssqlConnectionString: true, longhaulClient: true },
  })
  if (!tenant?.mssqlConnectionString) {
    logger.warn('Tenant has no mssqlConnectionString configured', { tenantId })
    return c.json(
      {
        error: 'Legacy database not configured for this tenant',
        code: 'MSSQL_NOT_CONFIGURED',
        correlationId,
      },
      422,
    )
  }
  if (!tenant.longhaulClient) {
    logger.warn('Tenant has no longhaulClient configured', { tenantId })
    return c.json(
      {
        error: 'Longhaul client not configured for this tenant',
        code: 'LONGHAUL_CLIENT_NOT_CONFIGURED',
        correlationId,
      },
      422,
    )
  }
  const connectionString = tenant.mssqlConnectionString
  // Per-client import/export codes for the Is_Trip_Planning filter — resolved
  // from the tenant's longhaulClient ('nwi' | 'qmm'), not a process-env value.
  const { importExportTypes } = getLonghaulClientConfigFor(tenant.longhaulClient)

  // ----- parse query params (mirror on-prem handler) -----
  let query: ShipmentQuery = {}
  const rawFilters = c.req.query('filters')
  if (rawFilters) {
    try {
      query = JSON.parse(rawFilters) as ShipmentQuery
    } catch {
      return c.json({ error: 'Invalid filters JSON', code: 'VALIDATION_ERROR', correlationId }, 400)
    }
  }
  const searchTerm = c.req.query('searchTerm')
  if (searchTerm) query.searchTerm = searchTerm

  try {
    // --- round trip 1: base shipments query ---
    const baseBag = new ParamBag()
    const baseSql = buildBaseSql(query, baseBag, importExportTypes)
    const baseRes = await executeSql(connectionString, baseSql, { params: baseBag.params })
    const { rows: rawShipments, dropped: duplicateRows } = dedupeByOrderNum(
      baseRes.recordset as ShipmentRow[],
    )
    if (duplicateRows > 0) {
      // Warn rather than swallow: the query can't fan out any more, so a hit
      // here means the tenant's shipments view itself is returning an order
      // twice — worth seeing, even though the list is now correct regardless.
      logger.warn('longhaul shipments-list collapsed duplicate order_num rows', {
        tenantId,
        duplicateRows,
      })
    }

    const orderNums = rawShipments
      .map((s) => s.order_num)
      .filter((n): n is number => typeof n === 'number')

    const activitiesByOrder: Record<number, ActivityRow[]> = {}
    const coverageByOrder: Record<number, unknown> = {}
    const extraByOrder: Record<number, ExtraLocationRow[]> = {}
    const activityTypesMap: Record<string, ActivityType> = {}

    if (orderNums.length > 0) {
      // Round trips 2 + 3 are independent — run them concurrently. Trip 3
      // (extra_locations) is soft-failed because the pegasus_extra_location
      // table is absent on some tenants, matching the on-prem `.catch(() => [])`.
      const enrichBag = new ParamBag()
      const extraBag = new ParamBag()
      const [enrichRes, extraRes] = await Promise.all([
        executeSql(connectionString, buildEnrichmentSql(orderNums, enrichBag), {
          params: enrichBag.params,
        }),
        executeSql(connectionString, buildExtraLocationsSql(orderNums, extraBag), {
          params: extraBag.params,
        }).catch((err: unknown) => {
          logger.warn('longhaul extra_locations lookup failed; treating as empty', {
            error: String(err),
          })
          return { recordset: [] as unknown[], rowsAffected: [] }
        }),
      ])

      for (const row of enrichRes.recordset as EnrichmentRow[]) {
        const payload = parsePayload(row)
        if (!payload) continue
        if (row.__src === 'activity') {
          const on = row.__order_num as number
          ;(activitiesByOrder[on] ??= []).push(payload as ActivityRow)
        } else if (row.__src === 'coverage') {
          coverageByOrder[row.__order_num as number] = payload
        } else if (row.__src === 'type') {
          const code = payload['code']
          if (typeof code === 'string') activityTypesMap[code] = payload as ActivityType
        }
      }

      for (const e of extraRes.recordset as ExtraLocationRow[]) {
        const on = e['order_num'] as number
        ;(extraByOrder[on] ??= []).push(e)
      }
    }

    // ----- assemble + enrich (mirror on-prem handler exactly) -----
    const filters = (query.filters as Record<string, unknown> | undefined) ?? {}
    const tripStatusIds = filters['TripStatus_id'] as Array<{ value: string | number }> | undefined
    const wantedTripStatusIds =
      tripStatusIds && tripStatusIds.length > 0
        ? new Set(tripStatusIds.map((v) => String(v.value)))
        : null

    const enriched: ShipmentRow[] = []
    for (const raw of rawShipments) {
      const on = raw.order_num as number
      raw.activities = activitiesByOrder[on] ?? []
      raw.packing_coverage = coverageByOrder[on] ?? null
      raw.extra_locations = extraByOrder[on] ?? []

      // getTripInfo enrichment must run before buildShipmentActivities, which
      // replaces `activities` with the untripped subset + generated templates.
      enrichShipmentWithTripInfo(raw)
      if (wantedTripStatusIds && !wantedTripStatusIds.has(String(raw['TripStatus_id'] ?? ''))) {
        continue
      }
      raw.activities = buildShipmentActivities(raw, activityTypesMap) as ActivityRow[]
      raw.extraActivities = buildExtraShipmentActivities(raw, activityTypesMap)
      enriched.push(raw)
    }

    if (enriched.length > SHIPMENT_RESULT_LIMIT) {
      return c.json(
        {
          error: 'Too many results — please narrow your filters.',
          code: 'RESULT_LIMIT_EXCEEDED',
          correlationId,
        },
        400,
      )
    }

    return c.json({ data: enriched, meta: { count: enriched.length } })
  } catch (err) {
    logger.error('longhaul cloud shipments-list failed', { error: String(err) })
    return c.json(
      { error: 'Failed to fetch shipments', code: 'INTERNAL_ERROR', correlationId },
      500,
    )
  }
}
