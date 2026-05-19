// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /states` handler.
//
// Phase 3 of the longhaul strangler-fig migration: serves
// GET /api/v1/onprem/longhaul/states from the cloud Hono Lambda instead of
// proxying it to the tenant's on-prem server. Mounted in app.ts ahead of the
// /onprem wildcard proxy so Hono route precedence routes /states here while
// every un-migrated longhaul endpoint still falls through to the proxy.
//
// `/states` is reference data — it runs one query through the in-VPC
// mssql-executor Lambda and matches the on-prem response shape exactly:
// `{ data: [...] }` (see repositories/longhaul/reference.repository.ts →
// getStates: `SELECT * FROM v_longhaul_states`).
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'
import { logger } from '../../lib/logger'

const STATES_SQL = 'SELECT * FROM v_longhaul_states'

export const longhaulStatesHandler: Handler<AppEnv> = async (c) => {
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
    const { recordset } = await executeSql(tenant.mssqlConnectionString, STATES_SQL)
    return c.json({ data: recordset })
  } catch (err) {
    logger.error('longhaul cloud states failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch states',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
}
