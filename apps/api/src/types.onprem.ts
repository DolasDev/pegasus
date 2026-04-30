// ---------------------------------------------------------------------------
// On-prem Hono environment types
//
// Extends the base AppVariables with context vars that only exist on routes
// backed by the legacy MSSQL database (pegii, efwk, longhaul). These routes
// are excluded from the Lambda bundle and only mount in server.ts.
// ---------------------------------------------------------------------------

import type { ConnectionPool } from 'mssql'
import type { Knex } from 'knex'
import type { AppVariables } from './types'

export type OnPremVariables = AppVariables & {
  /**
   * Legacy SQL Server connection pool for pegii/efwk routes.
   * Set by mssqlMiddleware after looking up the tenant's mssqlConnectionString.
   */
  mssqlPool: ConnectionPool
  /**
   * Knex instance for longhaul routes, backed by the tenant's mssqlConnectionString.
   * Set by longhaulUserMiddleware after looking up the tenant record.
   */
  longhaulDb: Knex
  /**
   * The authenticated longhaul user (from v_longhaul_salesman).
   * Set by longhaulUserMiddleware in two cases:
   *   - SKIP_AUTH=true: resolved from the X-Windows-User header.
   *   - Cognito-authenticated: resolved from TenantUser.legacyUserId.
   * Undefined for M2M-authenticated requests.
   */
  longhaulUser:
    | { code: number; first_name: string; last_name: string; [key: string]: unknown }
    | undefined
}

/** Hono environment type for on-prem routes (pegii, efwk, longhaul). */
export type OnPremEnv = { Variables: OnPremVariables }
