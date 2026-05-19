// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /shipment-filters/default` handler.
//
// Phase 3 of the longhaul strangler-fig migration: serves
// GET /api/v1/onprem/longhaul/shipment-filters/default from the cloud Hono
// Lambda instead of proxying it to the tenant's on-prem server. Mounted in
// app.ts ahead of the /onprem wildcard proxy so Hono route precedence routes
// this path here while every un-migrated longhaul endpoint still falls through
// to the proxy.
//
// Unlike `/version`, this endpoint is user-scoped: it returns the default
// shipment filter for the current user. Identity is resolved by mirroring
// middleware/longhaul-user.ts — the Cognito user's TenantUser is mapped to a
// legacy Windows username, which is looked up in `v_longhaul_salesman`. The
// salesman's `code` is the `user_id` key into `longhaul_user_preferences`.
//
// It reads `longhaul_user_preferences` for the user's `default_filter_id` and,
// when set, fetches that row from `longhaul_shipment_filter`. The stored
// `query` JSON has date fields persisted as integer day-offsets from today;
// the on-prem handler converts them back to absolute dates before responding.
// The response shape matches the on-prem handler exactly: `{ data: ... }`,
// where data is null when the user has no default filter.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'
import { logger } from '../../lib/logger'

// Date fields are stored as integer offsets from today so that saved filters
// remain meaningful across days. Mirrors longhaul/filter-options.ts.
const DATE_FIELDS = ['pack_date', 'load_date', 'delivery_date']

/** Resolve the longhaul salesman row for the current user. */
const SALESMAN_SQL = 'SELECT * FROM v_longhaul_salesman WHERE LOWER(win_username) = LOWER(@u)'

// On-prem reads user preferences then the referenced filter in two queries
// (filter-options.repository.ts getDefaultFilter). Collapsed here to a single
// JOIN: the filter row is returned only when the user has a default set.
const DEFAULT_FILTER_SQL = `
  SELECT f.*
  FROM longhaul_user_preferences p
  JOIN longhaul_shipment_filter f ON f.filter_id = p.default_filter_id
  WHERE p.user_id = @userId
`

/** Convert stored integer day-offsets back to absolute YYYY-MM-DD dates. */
function transformTimeDiffToDate(query: Record<string, unknown>): Record<string, unknown> {
  const filters = { ...((query['filters'] as Record<string, unknown>) ?? {}) }

  for (const field of DATE_FIELDS) {
    const range = filters[field]
    if (Array.isArray(range)) {
      filters[field] = range.map((offset: unknown) => {
        if (offset == null || isNaN(Number(offset))) return offset
        const today = new Date()
        today.setDate(today.getDate() + Number(offset))
        const dd = String(today.getDate()).padStart(2, '0')
        const mm = String(today.getMonth() + 1).padStart(2, '0')
        const yyyy = today.getFullYear()
        return `${yyyy}-${mm}-${dd}`
      })
    }
  }

  return { ...query, filters }
}

export const longhaulShipmentFiltersDefaultHandler: Handler<AppEnv> = async (c) => {
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

  // --- Identity resolution — mirrors middleware/longhaul-user.ts:171-241 -----
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

  const tenantUser = await db.tenantUser.findUnique({
    where: { id: userId },
    select: { legacyWindowsUsername: true },
  })
  if (tenantUser?.legacyWindowsUsername == null) {
    logger.warn('longhaul auth rejected — TenantUser has no legacyWindowsUsername', {
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
    const salesmanResult = await executeSql(tenant.mssqlConnectionString, SALESMAN_SQL, {
      params: [{ name: 'u', value: tenantUser.legacyWindowsUsername }],
    })
    const user = salesmanResult.recordset[0] as Record<string, unknown> | undefined
    if (!user || (user['active'] as string | undefined)?.toLowerCase() !== 'y') {
      logger.warn('longhaul auth rejected — legacy user inactive or missing', {
        userId,
        legacyWindowsUsername: tenantUser.legacyWindowsUsername,
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

    // --- Fetch the default filter for this user -----------------------------
    const { recordset } = await executeSql(tenant.mssqlConnectionString, DEFAULT_FILTER_SQL, {
      params: [{ name: 'userId', value: user['code'] }],
    })
    const filter = recordset[0] as Record<string, unknown> | undefined
    if (!filter) return c.json({ data: null })

    try {
      const parsed = JSON.parse(filter['query'] as string)
      return c.json({
        data: { ...filter, query: JSON.stringify(transformTimeDiffToDate(parsed)) },
      })
    } catch {
      return c.json({ data: filter })
    }
  } catch (err) {
    logger.error('longhaul cloud shipment-filters/default failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch default filter',
        code: 'INTERNAL_ERROR',
        correlationId,
      },
      500,
    )
  }
}
