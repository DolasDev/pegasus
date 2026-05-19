// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /users/me` handler.
//
// Phase 3 of the longhaul strangler-fig migration: serves
// GET /api/v1/onprem/longhaul/users/me from the cloud Hono Lambda instead of
// proxying it to the tenant's on-prem server. Mounted in app.ts ahead of the
// /onprem wildcard proxy so Hono route precedence routes /users/me here while
// every un-migrated longhaul endpoint still falls through to the proxy.
//
// Unlike /version, this endpoint resolves the caller's legacy identity. It
// mirrors middleware/longhaul-user.ts (Cognito-user branch): map the cloud
// userId → TenantUser.legacyWindowsUsername, then look the Windows username up
// in v_longhaul_salesman. The response shape matches the on-prem handler —
// `{ data: <longhaul user object> }`.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'
import { logger } from '../../lib/logger'

const SALESMAN_SQL = 'SELECT * FROM v_longhaul_salesman WHERE LOWER(win_username) = LOWER(@u)'

export const longhaulUsersMeHandler: Handler<AppEnv> = async (c) => {
  const tenantId = c.get('tenantId')
  const correlationId = c.get('correlationId')
  const userId = c.get('userId')

  if (!userId) {
    return c.json(
      {
        error: 'Missing or invalid API key',
        code: 'UNAUTHORIZED',
        correlationId,
      },
      401,
    )
  }

  const [tenant, tenantUser] = await Promise.all([
    db.tenant.findUnique({
      where: { id: tenantId },
      select: { mssqlConnectionString: true },
    }),
    db.tenantUser.findUnique({
      where: { id: userId },
      select: { legacyWindowsUsername: true },
    }),
  ])

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

  if (tenantUser?.legacyWindowsUsername == null) {
    logger.warn('longhaul users/me rejected — TenantUser has no legacyWindowsUsername', {
      userId,
      code: 'LONGHAUL_USER_NOT_MAPPED',
      correlationId,
    })
    return c.json(
      {
        error:
          'No legacy user mapping configured for this account. Ask a tenant administrator to set the Windows username on the Users settings page.',
        code: 'LONGHAUL_USER_NOT_MAPPED',
        correlationId,
      },
      422,
    )
  }

  try {
    const { recordset } = await executeSql(tenant.mssqlConnectionString, SALESMAN_SQL, {
      params: [{ name: 'u', value: tenantUser.legacyWindowsUsername }],
    })
    const row = recordset[0] as Record<string, unknown> | undefined

    if (!row || (row['active'] as string | undefined)?.toLowerCase() !== 'y') {
      logger.warn('longhaul users/me rejected — legacy user inactive or missing', {
        userId,
        legacyWindowsUsername: tenantUser.legacyWindowsUsername,
        active: row?.['active'],
        code: 'LONGHAUL_USER_NOT_FOUND',
        correlationId,
      })
      return c.json(
        {
          error: 'Legacy user is inactive or no longer exists',
          code: 'LONGHAUL_USER_NOT_FOUND',
          correlationId,
        },
        403,
      )
    }

    const longhaulUser = {
      code: row['code'] as number,
      first_name: row['first_name'] as string,
      last_name: row['last_name'] as string,
      ...row,
    }
    return c.json({ data: longhaulUser })
  } catch (err) {
    logger.error('longhaul cloud users/me failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch longhaul user',
        code: 'INTERNAL_ERROR',
        correlationId,
      },
      500,
    )
  }
}
