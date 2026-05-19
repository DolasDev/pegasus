// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /dispatchers` handler.
//
// Phase 3 of the longhaul strangler-fig migration: serves
// GET /api/v1/onprem/longhaul/dispatchers from the cloud Hono Lambda instead
// of proxying it to the tenant's on-prem server. Mounted in app.ts ahead of
// the /onprem wildcard proxy so Hono route precedence routes /dispatchers here
// while every un-migrated longhaul endpoint still falls through to the proxy.
//
// Mirrors the on-prem `getDispatchers` repository: queries v_longhaul_salesman
// with a per-client WHERE fragment. The client ('nwi' | 'qmm') is resolved per
// tenant from `Tenant.longhaulClient` — the multi-tenant cloud Lambda cannot
// use the on-prem server's LONGHAUL_CLIENT env var. The `dispatcherQuery`
// fragment is a server-side config constant (not user input — same as the
// on-prem `whereRaw(dispatcherQuery)`), so it is interpolated into the SQL
// string directly. Runs one query through the in-VPC mssql-executor Lambda and
// matches the on-prem response shape exactly: `{ data: [...] }`.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'
import { getLonghaulClientConfigFor } from '../../lib/longhaul-client-config'
import { logger } from '../../lib/logger'

export const longhaulDispatchersHandler: Handler<AppEnv> = async (c) => {
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
  if (!tenant.longhaulClient) {
    logger.warn('Tenant has no longhaulClient configured', { tenantId })
    return c.json(
      {
        error: 'Longhaul client not configured for this tenant',
        code: 'LONGHAUL_CLIENT_NOT_CONFIGURED',
        correlationId: c.get('correlationId'),
      },
      422,
    )
  }

  try {
    const { dispatcherQuery } = getLonghaulClientConfigFor(tenant.longhaulClient)
    const sql = `SELECT * FROM v_longhaul_salesman WHERE ${dispatcherQuery}`
    const { recordset } = await executeSql(tenant.mssqlConnectionString, sql)
    return c.json({ data: recordset })
  } catch (err) {
    logger.error('longhaul cloud dispatchers failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch dispatchers',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
}
