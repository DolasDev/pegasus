// ---------------------------------------------------------------------------
// On-prem Hono environment types
//
// Extends the base AppVariables with context vars that only exist on routes
// backed by the legacy MSSQL database (pegii, efwk). These routes are excluded
// from the Lambda bundle and only mount in server.ts.
// ---------------------------------------------------------------------------

import type { ConnectionPool } from 'mssql'
import type { AppVariables } from './types'

export type OnPremVariables = AppVariables & {
  /**
   * Legacy SQL Server connection pool for pegii/efwk routes.
   * Set by mssqlMiddleware after looking up the tenant's mssqlConnectionString.
   */
  mssqlPool: ConnectionPool
}

/** Hono environment type for on-prem routes (pegii, efwk). */
export type OnPremEnv = { Variables: OnPremVariables }
