// ---------------------------------------------------------------------------
// Longhaul cloud-write identity resolver.
//
// Phase 4 of the longhaul strangler-fig migration: cloud-direct WRITE handlers
// need the acting legacy user's salesman `code` to stamp audit columns
// (created_by_id / updated_by_id / modified_by), exactly as the on-prem path
// does via longhaulUserMiddleware (middleware/longhaul-user.ts). The cloud READ
// handlers don't need identity; the writes do.
//
// This is the cloud-side port of the middleware's Cognito + M2M branches,
// resolving the same identity through the in-VPC mssql-executor Lambda instead
// of a per-tenant Knex connection. It returns a discriminated result so a
// handler can short-circuit with the SAME status/code parity as the proxy:
//
//   - 401 UNAUTHORIZED          — neither a Cognito user nor an API client.
//   - 422 MSSQL_NOT_CONFIGURED  — tenant has no mssqlConnectionString.
//   - 422 LONGHAUL_USER_NOT_MAPPED — TenantUser has no legacyWindowsUsername.
//   - 403 FORBIDDEN             — M2M client missing the required write scope.
//   - 403 LONGHAUL_USER_NOT_FOUND  — legacy salesman missing or inactive.
//   - 503 MSSQL_UNAVAILABLE     — the executor/MSSQL lookup itself failed.
//
// On success it returns the tenant connection string (so the handler skips a
// second Prisma round trip) plus the legacy user `code`. For the M2M path
// there is no Cognito identity to map, so `code` is null — matching the proxy,
// where the M2M branch never sets `longhaulUser` and writes stamp `null`.
// ---------------------------------------------------------------------------

import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { db as prisma } from '../db'
import { executeSql } from './mssql-executor-client'
import { hasScope } from './scopes'
import { logger } from './logger'

const SALESMAN_SQL = 'SELECT * FROM v_longhaul_salesman WHERE LOWER(win_username) = LOWER(@u)'

export interface ResolveLonghaulUserArgs {
  tenantId: string
  /** Cognito-authenticated TenantUser id (c.get('userId')). Undefined for M2M. */
  userId?: string | undefined
  /** M2M API client (c.get('apiClient')). Undefined for Cognito requests. */
  apiClient?: { scopes: string[] } | undefined
  /** Scope the M2M client must hold for this write. Defaults to 'longhaul:write'. */
  requiredScope?: string
}

export type LonghaulUserError = {
  ok: false
  status: ContentfulStatusCode
  error: string
  code: string
}

export type LonghaulUserOk = {
  ok: true
  /** Tenant MSSQL connection string — pass straight to executeSql. */
  connectionString: string
  /**
   * The legacy salesman `code` to stamp on audit columns, or null for the M2M
   * path (no Cognito identity to map — parity with the proxy).
   */
  code: number | null
  /** The full v_longhaul_salesman row, or null for the M2M path. */
  user: Record<string, unknown> | null
}

export type LonghaulUserResult = LonghaulUserOk | LonghaulUserError

/**
 * Resolve the acting legacy longhaul user for a cloud-direct WRITE. Mirrors the
 * Cognito + M2M branches of middleware/longhaul-user.ts but runs the salesman
 * lookup through the mssql-executor Lambda. Returns a discriminated result; the
 * caller renders `{ error, code, correlationId }` at `status` when `ok` is false.
 */
export async function resolveLonghaulUser(
  args: ResolveLonghaulUserArgs,
): Promise<LonghaulUserResult> {
  const { tenantId, userId, apiClient, requiredScope = 'longhaul:write' } = args

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { mssqlConnectionString: true },
  })
  if (!tenant?.mssqlConnectionString) {
    logger.warn('Tenant has no mssqlConnectionString configured', { tenantId })
    return {
      ok: false,
      status: 422,
      error: 'Legacy database not configured for this tenant',
      code: 'MSSQL_NOT_CONFIGURED',
    }
  }
  const connectionString = tenant.mssqlConnectionString

  // --- M2M path: no Cognito identity to map, just enforce the write scope. ---
  if (!userId) {
    if (!apiClient) {
      return { ok: false, status: 401, error: 'Missing or invalid API key', code: 'UNAUTHORIZED' }
    }
    if (!hasScope(requiredScope, apiClient.scopes)) {
      return {
        ok: false,
        status: 403,
        error: `Forbidden: missing required scope "${requiredScope}"`,
        code: 'FORBIDDEN',
      }
    }
    return { ok: true, connectionString, code: null, user: null }
  }

  // --- Cognito path: map userId → legacyWindowsUsername → v_longhaul_salesman. ---
  const tenantUser = await prisma.tenantUser.findUnique({
    where: { id: userId },
    select: { legacyWindowsUsername: true },
  })

  if (tenantUser?.legacyWindowsUsername == null) {
    logger.warn('longhaul write rejected — TenantUser has no legacyWindowsUsername', {
      userId,
      code: 'LONGHAUL_USER_NOT_MAPPED',
    })
    return {
      ok: false,
      status: 422,
      error:
        'No legacy user mapping configured for this account. Ask a tenant administrator to set the Windows username on the Users settings page.',
      code: 'LONGHAUL_USER_NOT_MAPPED',
    }
  }

  let row: Record<string, unknown> | undefined
  try {
    const { recordset } = await executeSql(connectionString, SALESMAN_SQL, {
      params: [{ name: 'u', value: tenantUser.legacyWindowsUsername }],
    })
    row = recordset[0] as Record<string, unknown> | undefined
  } catch (err) {
    logger.error('longhaul write — failed to look up legacy user', {
      error: String(err),
      legacyWindowsUsername: tenantUser.legacyWindowsUsername,
    })
    return { ok: false, status: 503, error: 'MSSQL query failed', code: 'MSSQL_UNAVAILABLE' }
  }

  if (!row || (row['active'] as string | undefined)?.toLowerCase() !== 'y') {
    logger.warn('longhaul write rejected — legacy user inactive or missing', {
      userId,
      legacyWindowsUsername: tenantUser.legacyWindowsUsername,
      active: row?.['active'],
      code: 'LONGHAUL_USER_NOT_FOUND',
    })
    return {
      ok: false,
      status: 403,
      error: 'Legacy user is inactive or no longer exists',
      code: 'LONGHAUL_USER_NOT_FOUND',
    }
  }

  return { ok: true, connectionString, code: row['code'] as number, user: row }
}
