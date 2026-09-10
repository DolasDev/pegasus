// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /activities` (LIST) handler.
//
// Backs the Dispatch Activities board — the first Operations screen whose unit
// of work is the ACTIVITY rather than the shipment. Every other longhaul list
// endpoint answers "which orders/trips match?"; this one answers "what has to
// happen on these dates?", which is the question a dispatcher actually opens
// their morning with.
//
// Mounted in app.ts ahead of the /onprem/longhaul/* wildcard proxy, like every
// other cloud-direct GET, so Hono route precedence lands it here.
//
// ONE round trip. `LongDistanceDispatchActivity` joins straight to
// `v_longhaul_shipments_v2` on order_num, and that join is what makes the
// shipment-level filters (dispatcher, short haul) expressible in SQL on an
// activity query — no post-fetch pass, no second query, and `meta.count` stays
// truthful for free.
//
// Two deliberate departures from shipments-list.ts, both scars:
//   - EXPLICIT column list, never `a.*` alongside aliases. A projected column
//     whose name an alias reuses makes the mssql driver hand back an ARRAY for
//     that key instead of a scalar (#575).
//   - Plain SELECT, no `FOR JSON`. FOR JSON omits NULL-valued keys unless told
//     otherwise, which is the whole #629/#634 family of bugs. Nothing here needs
//     JSON aggregation, so the trap is simply not entered.
//
// READ-ONLY. `LongDistanceDispatchActivity` carries enabled AFTER triggers, but
// those only bite writes that use a bare OUTPUT clause.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { LonghaulShipmentViewColumn } from '@pegasus/longhaul-contracts'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql, type SqlParam } from '../../lib/mssql-executor-client'
import { logger } from '../../lib/logger'

/**
 * Hard cap on returned activities. Mirrors the shipments board's contract: past
 * this the response is a 400 telling the user to narrow, not a truncated list
 * that silently lies about what is scheduled.
 *
 * Activities outnumber shipments several-to-one (one order yields a PACK, a
 * LOAD, a DELIVERY and any extras), so the UI seeds a default date range rather
 * than opening on everything — see ACTIVITIES_DEFAULT_RANGE_DAYS in the client.
 */
const ACTIVITY_RESULT_LIMIT = 1000
// One more than the limit, so a run-away query still comes back small enough to
// answer with the 400 instead of dragging 100k rows through the executor.
const ACTIVITY_ROW_CAP = ACTIVITY_RESULT_LIMIT + 1

const A = 'a' // LongDistanceDispatchActivity
const S = 's' // v_longhaul_shipments_v2

/**
 * Filters the board sends, URL-encoded as `?filters=<json>`.
 *
 * The multi-selects arrive as react-select option objects (`{ label, value }`),
 * matching every other longhaul list endpoint. `date_range` is the exception:
 * it is a plain `[from, to]` pair of `YYYY-MM-DD` strings.
 *
 * NOTE the absence of `office`. The board renders an Office control, but there
 * is no office/branch dimension anywhere in the legacy schema — it is mocked in
 * the UI and deliberately sends nothing. When a real one lands, it joins here.
 */
interface ActivityFilters {
  /** Inclusive `[from, to]` of `YYYY-MM-DD` date-only strings. */
  date_range?: [string | null, string | null]
  /**
   * Activity-type ABBREVIATIONS, not codes.
   *
   * The client populates this control from `filterOptions.activityType`, which
   * reference-data.ts builds by de-duplicating `Longhaul_ActivityType`.
   * ABBREVIATION — so it is the abbreviation that arrives here, and filtering
   * on `ActivityType_code` would return nothing for every type whose code
   * differs from its abbreviation. Planning's "Last Activity" filter matches
   * the same token, for the same reason.
   *
   * One abbreviation can cover several codes (that is what the de-duplication
   * means); matching the abbreviation therefore selects all of them, which is
   * what a dispatcher picking "PACK" intends.
   */
  activity_type?: Array<{ value: string }>
  /** `v_longhaul_shipments_v2.haul_mode` values (the SHAUL_LIST codes). */
  short_haul?: Array<{ value: string }>
  /** `v_longhaul_shipments_v2.operations_id` — the dispatcher's salesman code. */
  operations_id?: Array<{ value: string }>
}

interface ActivityQuery {
  filters?: ActivityFilters
  sortBy?: { value?: string; order?: string }
}

/**
 * Sortable columns, whitelisted: an ORDER BY identifier cannot be
 * parameterized, so the map is the only thing standing between `sortBy` and SQL
 * injection. Keys are what the UI's column headers emit.
 */
const SORTABLE_COLUMNS: Record<string, string> = {
  estimated_date: `${A}.estimated_date`,
  actual_date: `${A}.actual_date`,
  activity_type: 'at.abbreviation',
  order_num: `${A}.order_num`,
  status: `${A}.status`,
  driver_name: 'drv.driver_name',
  city: `${A}.city`,
  state: `${A}.state`,
  shipper_name: `${S}.shipper_name`,
  dispatcher: `${S}.last_name`,
}

/**
 * Default ordering: the board is a work queue, so the soonest-dated activity
 * comes first, and `id` breaks ties so paging/caps are deterministic rather
 * than at the mercy of the query plan.
 */
const DEFAULT_ORDER_BY = `${A}.estimated_date ASC, ${A}.id ASC`

/** Accumulates WHERE clauses' bound params. Same pattern as shipments-list. */
class ParamBag {
  readonly params: SqlParam[] = []
  private seq = 0
  bind(value: unknown): string {
    const name = `p${this.seq++}`
    this.params.push({ name, value })
    return `@${name}`
  }
}

/**
 * Shipment-view columns this query reads, each paired with the alias it is
 * projected under.
 *
 * Typed as `LonghaulShipmentViewColumn` on purpose: that union is the checked-in
 * manifest of what `v_longhaul_shipments_v2` actually projects, and naming a
 * column the view does not have is the exact bug class that shipped four
 * production defects (#569-#571, #4) as blank cells. Here it is a compile error.
 *
 * Every one is aliased away from its source name so nothing in the output can
 * collide with an activity column — `${A}.state` and `${S}.consignee_state`
 * would otherwise both want to be `state`, and two output columns of one name
 * make the mssql driver return an ARRAY for that key (#575).
 *
 * (`last_name` really is the dispatcher's surname — the legacy entity exposed it
 * as `OpsLastName`, which is why #570 read a field that never existed.)
 */
const SHIPMENT_COLUMNS: ReadonlyArray<[LonghaulShipmentViewColumn, string]> = [
  ['shipper_name', 'shipper_name'],
  ['shipper_city', 'origin_city'],
  ['shipper_state', 'origin_state'],
  ['consignee_city', 'destination_city'],
  ['consignee_state', 'destination_state'],
  ['haul_mode', 'haul_mode'],
  ['shaul', 'shaul'],
  ['operations_id', 'operations_id'],
  ['last_name', 'dispatcher_last_name'],
  ['total_est_wt', 'total_est_wt'],
]

/**
 * The projection. Spelled out column by column — see the header note on #575.
 *
 * Everything the card renders comes from here; the board makes no second call
 * to resolve a type code, a driver name, or a dispatcher.
 */
const SELECT_COLUMNS = [
  `${A}.id`,
  `${A}.order_num`,
  `${A}.TripMaster_id`,
  `${A}.ActivityType_code`,
  `${A}.estimated_date`,
  `${A}.actual_date`,
  `${A}.planned_start`,
  `${A}.planned_end`,
  `${A}.status`,
  `${A}.street`,
  `${A}.unit`,
  `${A}.city`,
  `${A}.state`,
  `${A}.zip`,
  `${A}.is_active`,
  `${A}.is_confirmed`,
  `${A}.is_committed`,
  `${A}.assigned_driver_id`,
  `${A}.assigned_agent_code`,
  'at.name AS activity_type_name',
  'at.abbreviation AS activity_type_abbreviation',
  'drv.driver_name AS driver_name',
  ...SHIPMENT_COLUMNS.map(([col, alias]) => `${S}.${col} AS ${alias}`),
].join(', ')

const FROM_AND_JOINS =
  ` FROM LongDistanceDispatchActivity AS ${A}` +
  ` LEFT JOIN Longhaul_ActivityType AS at ON ${A}.ActivityType_code = at.code` +
  ` LEFT JOIN v_longhaul_drivers AS drv ON ${A}.assigned_driver_id = drv.driver_id` +
  ` LEFT JOIN v_longhaul_shipments_v2 AS ${S} ON ${A}.order_num = ${S}.order_num`

/**
 * Build the one query the handler runs.
 *
 * The date range filters `estimated_date` — the activity's SCHEDULED day —
 * and deliberately not an overlap test against `planned_start`/`planned_end`.
 * On this data `planned_end < planned_start` is legitimate rather than corrupt
 * (#619/#622), so an overlap predicate quietly drops the inverted spans.
 */
function buildActivitiesSql(query: ActivityQuery, bag: ParamBag): string {
  const where: string[] = []
  const f = query.filters ?? {}

  if (f.date_range) {
    const [from, to] = f.date_range
    // Both bounds are INCLUSIVE whole days — "the 4th through the 8th" includes
    // the 8th.
    //
    // The upper bound is `< @to + 1 day` rather than `<= @to` because the column
    // holds a calendar day in a DATETIME. It is *supposed* to be a naive
    // midnight, and lib/longhaul-date-only.ts now normalizes every write to one
    // — but that guard landed in #534, and rows written before it (by the
    // tenant-web pickers that persisted `toISOString()` off a local Date) still
    // carry times like `05:00:00`. `<= '2026-09-17'` compares against
    // `2026-09-17 00:00:00` and silently drops every one of them, which on a
    // board whose entire job is "show me this date" is the worst possible way
    // to be wrong.
    if (from) where.push(`${A}.estimated_date >= ${bag.bind(from)}`)
    if (to) where.push(`${A}.estimated_date < DATEADD(day, 1, ${bag.bind(to)})`)
  }

  if (f.activity_type?.length) {
    const vals = f.activity_type.map((t) => t.value).filter(Boolean)
    if (vals.length) {
      // `at.abbreviation`, NOT `a.ActivityType_code` — see ActivityFilters above.
      where.push(`at.abbreviation IN (${vals.map((v) => bag.bind(v)).join(', ')})`)
    }
  }

  // Short haul and dispatcher are SHIPMENT attributes reached through the
  // order_num join. Filtering them in SQL (not in JS after the fetch) also
  // dodges the padded-nvarchar trap that silently dropped import_export codes
  // in #628: MSSQL's comparison ignores trailing spaces, `===` does not.
  if (f.short_haul?.length) {
    const vals = f.short_haul.map((s) => s.value).filter(Boolean)
    if (vals.length) {
      where.push(`${S}.haul_mode IN (${vals.map((v) => bag.bind(v)).join(', ')})`)
    }
  }

  if (f.operations_id?.length) {
    const vals = f.operations_id.map((o) => o.value).filter(Boolean)
    if (vals.length) {
      where.push(`${S}.operations_id IN (${vals.map((v) => bag.bind(v)).join(', ')})`)
    }
  }

  const sortCol = query.sortBy?.value ? SORTABLE_COLUMNS[query.sortBy.value] : undefined
  const orderBy = sortCol
    ? `${sortCol} ${query.sortBy?.order === 'desc' ? 'DESC' : 'ASC'}, ${A}.id ASC`
    : DEFAULT_ORDER_BY

  return (
    `SELECT TOP (${ACTIVITY_ROW_CAP}) ${SELECT_COLUMNS}` +
    FROM_AND_JOINS +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY ${orderBy}`
  )
}

export const longhaulActivitiesListHandler: Handler<AppEnv> = async (c) => {
  const tenantId = c.get('tenantId')
  const correlationId = c.get('correlationId')

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
        correlationId,
      },
      422,
    )
  }

  // No longhaulClient preflight, unlike shipments-list: nothing in this query
  // is per-client. That handler needs it only to resolve the client's
  // import/export code set, which has no analogue here.

  let query: ActivityQuery = {}
  const rawFilters = c.req.query('filters')
  if (rawFilters) {
    try {
      query = JSON.parse(rawFilters) as ActivityQuery
    } catch {
      return c.json({ error: 'Invalid filters JSON', code: 'VALIDATION_ERROR', correlationId }, 400)
    }
  }

  try {
    const bag = new ParamBag()
    const sql = buildActivitiesSql(query, bag)
    const { recordset } = await executeSql(tenant.mssqlConnectionString, sql, {
      params: bag.params,
    })
    const rows = recordset as unknown[]

    if (rows.length > ACTIVITY_RESULT_LIMIT) {
      return c.json(
        {
          error: 'Too many activities — please narrow your date range or filters.',
          code: 'RESULT_LIMIT_EXCEEDED',
          correlationId,
        },
        400,
      )
    }

    return c.json({ data: rows, meta: { count: rows.length } })
  } catch (err) {
    logger.error('longhaul cloud activities-list failed', { error: String(err) })
    return c.json(
      { error: 'Failed to fetch activities', code: 'INTERNAL_ERROR', correlationId },
      500,
    )
  }
}
