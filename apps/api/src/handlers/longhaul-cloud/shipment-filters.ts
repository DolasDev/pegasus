// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /shipment-filters` handler.
//
// Phase 3 of the longhaul strangler-fig migration: serves
// GET /api/v1/onprem/longhaul/shipment-filters from the cloud Hono Lambda
// instead of proxying it to the tenant's on-prem server. Mounted in app.ts
// ahead of the /onprem wildcard proxy so Hono route precedence routes this
// path here while every un-migrated longhaul endpoint still falls through.
//
// Unlike /version, this endpoint is user-scoped: it resolves the caller's
// legacy longhaul identity (via TenantUser.legacyWindowsUsername →
// v_longhaul_salesman) and filters saved filters by that user's `code` —
// mirroring middleware/longhaul-user.ts. It runs every query through the
// in-VPC mssql-executor Lambda and matches the on-prem response shape exactly:
// `{ data: [...] }`.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'
import { logger } from '../../lib/logger'

// Date fields are stored as integer offsets from today so saved filters stay
// meaningful across days. On read, the on-prem handler converts the stored
// offsets back to absolute dates — replicated here verbatim.
const DATE_FIELDS = ['pack_date', 'load_date', 'delivery_date']

/** Convert stored integer day-offsets back to absolute `YYYY-MM-DD` dates. */
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

// SQL mirrors getSavedFiltersForUser in filter-options.repository.ts:
//   self   → owner_code = @ownerCode AND is_public = 0
//   public → is_public = 1 (regardless of owner)
// ordered by name ascending in both cases.
//
// Each row LEFT JOINs v_longhaul_salesman on owner_code = code to resolve the
// creator's name — mirroring the planner/dispatcher joins in trips-list.ts. The
// "Created By" column in the FilterModal reads `owner.first_name`/`owner.last_name`,
// so without this join those names render blank (the table only stores owner_code).
// The join is a LEFT join so a filter whose owner no longer exists still returns.
const FILTERS_SELECT =
  'SELECT f.*, s.first_name AS owner_first_name, s.last_name AS owner_last_name ' +
  'FROM longhaul_shipment_filter f ' +
  'LEFT JOIN v_longhaul_salesman s ON f.owner_code = s.code'
const SELF_FILTERS_SQL = `${FILTERS_SELECT} WHERE f.owner_code = @ownerCode AND f.is_public = 0 ORDER BY f.name ASC`
const PUBLIC_FILTERS_SQL = `${FILTERS_SELECT} WHERE f.is_public = 1 ORDER BY f.name ASC`

// SQL mirrors getUserByWindowsUsername in reference.repository.ts.
const SALESMAN_SQL = 'SELECT * FROM v_longhaul_salesman WHERE LOWER(win_username) = LOWER(@u)'

interface ShipmentFilterRow {
  query?: unknown
  owner_first_name?: string | null
  owner_last_name?: string | null
  [key: string]: unknown
}

export const longhaulShipmentFiltersHandler: Handler<AppEnv> = async (c) => {
  const correlationId = c.get('correlationId')
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
        correlationId,
      },
      422,
    )
  }
  const connectionString = tenant.mssqlConnectionString

  // -- resolve the longhaul user (mirrors middleware/longhaul-user.ts) --------
  const userId = c.get('userId')
  if (!userId) {
    return c.json({ error: 'Missing or invalid API key', code: 'UNAUTHORIZED', correlationId }, 401)
  }

  const tenantUser = await db.tenantUser.findUnique({
    where: { id: userId },
    select: { legacyWindowsUsername: true },
  })
  if (tenantUser?.legacyWindowsUsername == null) {
    logger.warn('longhaul shipment-filters rejected — TenantUser has no legacyWindowsUsername', {
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
    const { recordset: userRows } = await executeSql(connectionString, SALESMAN_SQL, {
      params: [{ name: 'u', value: tenantUser.legacyWindowsUsername }],
    })
    const user = userRows[0] as Record<string, unknown> | undefined

    if (!user || (user['active'] as string | undefined)?.toLowerCase() !== 'y') {
      logger.warn('longhaul shipment-filters rejected — legacy user inactive or missing', {
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

    // -- fetch saved filters scoped to the resolved user ---------------------
    const ownerCode = user['code']
    const typeParam = c.req.query('type')
    const type: 'self' | 'public' = typeParam === 'public' ? 'public' : 'self'

    const { recordset } =
      type === 'public'
        ? await executeSql(connectionString, PUBLIC_FILTERS_SQL)
        : await executeSql(connectionString, SELF_FILTERS_SQL, {
            params: [{ name: 'ownerCode', value: ownerCode }],
          })

    // Reshape each row: fold the joined salesman columns into a nested `owner`
    // object (what the FilterModal "Created By" column reads), then apply the
    // on-prem `query` transform — parse the stored JSON and convert stored date
    // offsets back to absolute dates. Rows whose `query` is not valid JSON keep
    // their raw query string but still get the `owner` object.
    const data = (recordset as ShipmentFilterRow[]).map((row) => {
      const { owner_first_name, owner_last_name, ...rest } = row
      const owner =
        owner_first_name != null || owner_last_name != null
          ? {
              code: rest['owner_code'] ?? null,
              first_name: owner_first_name ?? null,
              last_name: owner_last_name ?? null,
            }
          : null
      try {
        const parsed = JSON.parse(rest.query as string)
        return { ...rest, owner, query: JSON.stringify(transformTimeDiffToDate(parsed)) }
      } catch {
        return { ...rest, owner }
      }
    })

    return c.json({ data })
  } catch (err) {
    logger.error('longhaul cloud shipment-filters failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch saved filters',
        code: 'INTERNAL_ERROR',
        correlationId,
      },
      500,
    )
  }
}
