// ---------------------------------------------------------------------------
// On-prem Hono environment types
//
// Extends the base AppVariables with context vars that only exist on routes
// backed by the legacy MSSQL database (pegii, efwk, longhaul). These routes
// are excluded from the Lambda bundle and only mount in server.ts.
// ---------------------------------------------------------------------------

import type { ConnectionPool } from 'mssql'
import type { AppVariables } from './types'

export type OnPremVariables = AppVariables & {
  /**
   * Legacy SQL Server connection pool for pegii/efwk routes.
   * Set by mssqlMiddleware after looking up the tenant's mssqlConnectionString.
   */
  mssqlPool: ConnectionPool
  /**
   * The authenticated longhaul user (from v_longhaul_salesman).
   * Set by longhaulUserMiddleware when SKIP_AUTH=true and X-Windows-User header
   * is provided. Undefined for M2M-authenticated requests.
   */
  longhaulUser:
    | { code: number; first_name: string; last_name: string; [key: string]: unknown }
    | undefined
}

/** Hono environment type for on-prem routes (pegii, efwk, longhaul). */
export type OnPremEnv = { Variables: OnPremVariables }
