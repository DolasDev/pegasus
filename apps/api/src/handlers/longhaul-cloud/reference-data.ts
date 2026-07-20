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
// from the batch and returns `dispatchers: []` / `filterOptions: { moveType:
// [] }`, logging a warning. It does NOT 422 the whole call.
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
import { longhaulDriverFilter } from './driver-filter'
import { longhaulSalesmanActiveFilter } from './salesman-filter'

type Row = Record<string, unknown>

// Client-independent statements — always present in the batch, in this order.
// recordsets[0] = drivers      (lowercase-aliased from v_longhaul_drivers)
// recordsets[1] = tripStatuses (MasterTripStatus)
// recordsets[2] = states       (v_longhaul_states)
// recordsets[3] = zones        (v_longhaul_zones)
// recordsets[4] = planners     (active v_longhaul_salesman filtered to TripMaster.created_by_id)
//
// When the tenant has a longhaulClient configured the next two are appended:
// recordsets[5] = dispatchers   (active v_longhaul_salesman filtered by per-client SQL fragment)
// recordsets[6] = MoveType rows (reshaped to filterOptions.moveType server-side)
const COMMON_BATCH_SQL = `
SELECT
  DRIVER_ID AS driver_id,
  DRIVER_NAME AS driver_name,
  AGENT_CODE AS agent_code,
  ACTIVE AS active,
  TYPE AS type
FROM v_longhaul_drivers
WHERE ${longhaulDriverFilter()};

SELECT * FROM MasterTripStatus;

SELECT * FROM v_longhaul_states;

SELECT * FROM v_longhaul_zones;

SELECT * FROM v_longhaul_salesman
WHERE ${longhaulSalesmanActiveFilter('[v_longhaul_salesman]')}
AND [v_longhaul_salesman].code IN
  (SELECT DISTINCT created_by_id FROM TripMaster WHERE created_by_id IS NOT NULL);
`

interface MoveTypeRow {
  move_type_desc: string
  move_type: string
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

    let dispatchers: Row[] = []
    let filterOptions: { moveType: Array<{ value: string; label: string }> } = { moveType: [] }
    if (clientConfig) {
      dispatchers = (recordsets[5] ?? []) as Row[]
      const moveTypeRows = (recordsets[6] ?? []) as MoveTypeRow[]
      filterOptions = {
        moveType: moveTypeRows.map(({ move_type, move_type_desc }) => ({
          value: move_type,
          label: move_type_desc,
        })),
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
