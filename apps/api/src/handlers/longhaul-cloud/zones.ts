// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /zones` handler.
//
// Phase 3 of the longhaul strangler-fig migration: serves
// GET /api/v1/onprem/longhaul/zones from the cloud Hono Lambda instead of
// proxying it to the tenant's on-prem server. Mounted in app.ts ahead of the
// /onprem wildcard proxy so Hono route precedence routes /zones here while
// every un-migrated longhaul endpoint still falls through to the proxy.
//
// It runs one query through the in-VPC mssql-executor Lambda and matches the
// on-prem response shape exactly: `{ data: [...] }` (see the on-prem `/zones`
// route in handlers/longhaul/reference.ts → repository getZones).
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'
import { logger } from '../../lib/logger'

const ZONES_SQL = 'SELECT * FROM v_longhaul_zones'

export const longhaulZonesHandler: Handler<AppEnv> = async (c) => {
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
    const { recordset } = await executeSql(tenant.mssqlConnectionString, ZONES_SQL)
    return c.json({ data: recordset })
  } catch (err) {
    logger.error('longhaul cloud zones failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch zones',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
}
