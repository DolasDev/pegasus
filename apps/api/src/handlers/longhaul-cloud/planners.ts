// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /planners` handler.
//
// Phase 3 of the longhaul strangler-fig migration: serves
// GET /api/v1/onprem/longhaul/planners from the cloud Hono Lambda instead of
// proxying it to the tenant's on-prem server. Mounted in app.ts ahead of the
// /onprem wildcard proxy so Hono route precedence routes /planners here while
// every un-migrated longhaul endpoint still falls through to the proxy.
//
// Planners are the users whose `code` appears as a `created_by_id` in
// TripMaster. It runs one query through the in-VPC mssql-executor Lambda and
// matches the on-prem response shape exactly: `{ data: [...rows] }`.
//
// The on-prem `getPlanners` repository accepts an optional `plannerCodes`
// filter, but the on-prem route never passes it (it calls `getPlanners(db)`
// with no codes) — so this handler issues the unfiltered query to match.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'
import { logger } from '../../lib/logger'
import { longhaulSalesmanActiveFilter } from './salesman-filter'

// Active planners only. Note this narrows a list derived from historical
// TripMaster.created_by_id values, so a planner who has since been deactivated
// drops out of the dropdown even though past trips still reference them. That
// is a deliberate, accepted trade-off — if historical trip attribution needs
// the full set again, revert this predicate rather than the dispatcher one.
const PLANNERS_SQL =
  'SELECT * FROM v_longhaul_salesman ' +
  `WHERE ${longhaulSalesmanActiveFilter('[v_longhaul_salesman]')} ` +
  'AND [v_longhaul_salesman].code IN ' +
  '(SELECT DISTINCT created_by_id FROM TripMaster WHERE created_by_id IS NOT NULL)'

export const longhaulPlannersHandler: Handler<AppEnv> = async (c) => {
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

  try {
    const { recordset } = await executeSql(tenant.mssqlConnectionString, PLANNERS_SQL)
    return c.json({ data: recordset })
  } catch (err) {
    logger.error('longhaul cloud planners failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch planners',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
}
