// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /reference-data` handler — batched bootstrap.
//
// Background: the tenant Driver Planning UI (AppGuard) hydrates dropdowns on
// bootstrap by firing SEVEN parallel reference-data requests (drivers,
// trip-statuses, states, zones, planners, dispatchers, filter-options). Each
// one is a separate api Lambda → mssql-executor Lambda round trip, so a single
// "open Operations" wants ~14 concurrent Lambda slots. On a constrained
// concurrency budget that self-throttles (TooManyRequestsException) and
// surfaces as "Failed to load reference data" in the UI.
//
// This handler collapses the seven into a single multi-statement MSSQL batch
// and shapes the result so the client can fan it back out into the existing
// success reducers with no per-slice changes. The 7 standalone endpoints are
// retained for non-bootstrap callers (refresh buttons etc.) — see plan
// `plans/completed/longhaul-reference-data-batch.md` for the audit plan.
//
// Multi-statement result handling mirrors trip-detail.ts: the executor
// surfaces each statement in `recordsets[i]`. We read by index, so the SQL
// statement order MUST match the documented index map below. Adding or
// reordering statements is the main footgun.
//
// Per-client fragments (`dispatcherQuery`, `moveTypesWhere`) come from
// lib/longhaul-client-config.ts keyed on the tenant's `longhaulClient`. When
// the tenant has no `longhaulClient` configured today, only dispatchers +
// filter-options break — the other five lookups still load. This handler
// preserves that graceful degradation: it omits the two per-client statements
// from the batch and returns `dispatchers: []` / `filterOptions.moveType: []`,
// logging a warning. It does NOT 422 the whole call. `filterOptions.activityType`
// is NOT part of that degradation — the Longhaul_ActivityType catalog is
// client-independent, so it rides the common block and populates either way.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'
import {
  getLonghaulClientConfigFor,
  type LonghaulClientConfig,
} from '../../lib/longhaul-client-config'
import { logger } from '../../lib/logger'
import { activeDriverFilter } from './driver-filter'
import { longhaulSalesmanActiveFilter } from './salesman-filter'

type Row = Record<string, unknown>

// Client-independent statements — always present in the batch, in this order.
// recordsets[0] = drivers      (lowercase-aliased from v_longhaul_drivers)
// recordsets[1] = tripStatuses (MasterTripStatus)
// recordsets[2] = states       (v_longhaul_states)
// recordsets[3] = zones        (v_longhaul_zones)
// recordsets[4] = planners     (active v_longhaul_salesman filtered to TripMaster.created_by_id)
// recordsets[5] = activityTypes (Longhaul_ActivityType — reshaped to filterOptions.activityType)
//
// When the tenant has a longhaulClient configured the next two are appended:
// recordsets[6] = dispatchers   (active v_longhaul_salesman filtered by per-client SQL fragment)
// recordsets[7] = MoveType rows (reshaped to filterOptions.moveType server-side)
const COMMON_BATCH_SQL = `
SELECT
  DRIVER_ID AS driver_id,
  DRIVER_NAME AS driver_name,
  AGENT_CODE AS agent_code,
  ACTIVE AS active,
  TYPE AS type
FROM v_longhaul_drivers
WHERE ${activeDriverFilter()};

SELECT * FROM MasterTripStatus;

SELECT * FROM v_longhaul_states;

SELECT * FROM v_longhaul_zones;

SELECT * FROM v_longhaul_salesman
WHERE ${longhaulSalesmanActiveFilter('[v_longhaul_salesman]')}
AND [v_longhaul_salesman].code IN
  (SELECT DISTINCT created_by_id FROM TripMaster WHERE created_by_id IS NOT NULL);

SELECT code, name, abbreviation FROM Longhaul_ActivityType;
`

interface MoveTypeRow {
  move_type_desc: string
  move_type: string
}

interface ActivityTypeRow {
  code: string
  name: string | null
  abbreviation: string | null
}

/**
 * Reshape the Longhaul_ActivityType catalog into options for the planning
 * screen's Last Activity filter.
 *
 * Value AND label are the bare abbreviation, because that is exactly what the
 * shipment card prints in its Last Activity column — a planner reading a card
 * can pick the matching filter value with no translation step. It follows that:
 *
 *   - a type with no abbreviation is dropped: the card could never display it,
 *     so no shipment could ever be matched by it;
 *   - two codes sharing an abbreviation collapse to one option, because the
 *     card cannot tell them apart either (SITIN/SITOUT both print `SIT`).
 *
 * Trimmed for the same reason the handler trims when matching — see the filter
 * block in shipments-list.ts.
 */
function toActivityTypeOptions(rows: ActivityTypeRow[]): Array<{ value: string; label: string }> {
  const abbrs = new Set<string>()
  for (const { abbreviation } of rows) {
    const abbr = String(abbreviation ?? '').trim()
    if (abbr) abbrs.add(abbr)
  }
  return [...abbrs].sort().map((abbr) => ({ value: abbr, label: abbr }))
}

function buildBatchSql(client: LonghaulClientConfig | null): string {
  if (!client) return COMMON_BATCH_SQL
  return (
    COMMON_BATCH_SQL +
    `
SELECT * FROM v_longhaul_salesman WHERE ${longhaulSalesmanActiveFilter()} AND (${client.dispatcherQuery});

SELECT move_type_desc, move_type FROM MoveType WHERE ${client.moveTypesWhere} ORDER BY move_type_desc ASC;
`
  )
}

export const longhaulReferenceDataHandler: Handler<AppEnv> = async (c) => {
  const tenantId = c.get('tenantId')

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
        correlationId: c.get('correlationId'),
      },
      422,
    )
  }

  // Resolve the per-client fragments up-front. When longhaulClient is absent,
  // skip the per-client statements entirely (graceful degradation — today's
  // standalone /dispatchers and /filter-options 422 in that case but the other
  // 5 lookups still load; preserve that here by populating empties instead of
  // 422'ing the whole bootstrap).
  let clientConfig: LonghaulClientConfig | null = null
  if (tenant.longhaulClient) {
    try {
      clientConfig = getLonghaulClientConfigFor(tenant.longhaulClient)
    } catch (err) {
      logger.warn(
        'Tenant has an unrecognized longhaulClient; falling back to empty dispatchers + filterOptions',
        { tenantId, longhaulClient: tenant.longhaulClient, error: String(err) },
      )
    }
  } else {
    logger.warn(
      'Tenant has no longhaulClient configured; returning empty dispatchers + filterOptions',
      { tenantId },
    )
  }

  try {
    const batchSql = buildBatchSql(clientConfig)
    const { recordsets } = await executeSql(tenant.mssqlConnectionString, batchSql)

    const drivers = (recordsets[0] ?? []) as Row[]
    const tripStatuses = (recordsets[1] ?? []) as Row[]
    const states = (recordsets[2] ?? []) as Row[]
    const zones = (recordsets[3] ?? []) as Row[]
    const planners = (recordsets[4] ?? []) as Row[]
    // Client-independent, so it is populated in BOTH branches — the Last
    // Activity filter works on a tenant with no longhaulClient, where only the
    // two genuinely client-scoped lookups degrade to empty.
    const activityTypeOptions = toActivityTypeOptions((recordsets[5] ?? []) as ActivityTypeRow[])

    let dispatchers: Row[] = []
    let filterOptions: {
      moveType: Array<{ value: string; label: string }>
      activityType: Array<{ value: string; label: string }>
    } = { moveType: [], activityType: activityTypeOptions }
    if (clientConfig) {
      dispatchers = (recordsets[6] ?? []) as Row[]
      const moveTypeRows = (recordsets[7] ?? []) as MoveTypeRow[]
      filterOptions = {
        moveType: moveTypeRows.map(({ move_type, move_type_desc }) => ({
          value: move_type,
          label: move_type_desc,
        })),
        activityType: activityTypeOptions,
      }
    }

    return c.json({
      data: {
        drivers,
        tripStatuses,
        states,
        zones,
        planners,
        dispatchers,
        filterOptions,
      },
    })
  } catch (err) {
    logger.error('longhaul cloud reference-data failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch reference data',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
}
