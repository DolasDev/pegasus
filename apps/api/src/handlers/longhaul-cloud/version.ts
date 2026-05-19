// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /version` handler.
//
// Phase 1 of the longhaul strangler-fig migration: serves
// GET /api/v1/onprem/longhaul/version from the cloud Hono Lambda instead of
// proxying it to the tenant's on-prem server. Mounted in app.ts ahead of the
// /onprem wildcard proxy so Hono route precedence routes /version here while
// every un-migrated longhaul endpoint still falls through to the proxy.
//
// `/version` is a pure system smoke test — no user identity (see the /version
// exemption in middleware/longhaul-user.ts). It runs one query through the
// in-VPC mssql-executor Lambda and matches the on-prem response shape exactly:
// `{ data: { max: <version> } }`.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'
import { logger } from '../../lib/logger'

const VERSION_SQL = 'SELECT MAX(database_version) AS max FROM longhaul_versions'

/** Single-row shape of VERSION_SQL — mirrors the on-prem `getVersion` result. */
interface VersionRow {
  max: string | null
}

export const longhaulVersionHandler: Handler<AppEnv> = async (c) => {
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
    const { recordset } = await executeSql(tenant.mssqlConnectionString, VERSION_SQL)
    const row = recordset[0] as VersionRow | undefined
    return c.json({ data: row ?? null })
  } catch (err) {
    logger.error('longhaul cloud version failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch version',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
}
