// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /drivers` handler.
//
// Phase 3 of the longhaul strangler-fig migration: serves
// GET /api/v1/onprem/longhaul/drivers from the cloud Hono Lambda instead of
// proxying it to the tenant's on-prem server. Mounted in app.ts ahead of the
// /onprem wildcard proxy so Hono route precedence routes /drivers here while
// every un-migrated longhaul endpoint still falls through to the proxy.
//
// It runs one query through the in-VPC mssql-executor Lambda and matches the
// on-prem response shape exactly: `{ data: [...] }`.
//
// The Dolios `v_longhaul_drivers` view returns UPPERCASE column names
// (DRIVER_ID, DRIVER_NAME, AGENT_CODE, ACTIVE, TYPE). The on-prem `getDrivers`
// normalises them to lowercase via `lowercaseRowKeys`; the ported longhaul UI
// (DriverTypeahead, common.driversList) expects lowercase `driver_id` /
// `driver_name`. We replicate that by aliasing every column to lowercase in
// the SQL itself.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'
import { logger } from '../../lib/logger'
import { longhaulDriverFilter } from './driver-filter'

const DRIVERS_SQL = `SELECT
  DRIVER_ID AS driver_id,
  DRIVER_NAME AS driver_name,
  AGENT_CODE AS agent_code,
  ACTIVE AS active,
  TYPE AS type
FROM v_longhaul_drivers
WHERE ${longhaulDriverFilter()}`

export const longhaulDriversHandler: Handler<AppEnv> = async (c) => {
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
    const { recordset } = await executeSql(tenant.mssqlConnectionString, DRIVERS_SQL)
    return c.json({ data: recordset })
  } catch (err) {
    logger.error('longhaul cloud drivers failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch drivers',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
}
