// ---------------------------------------------------------------------------
// Longhaul MSSQL connection — per-tenant Knex pools keyed by connection string
//
// Uses the same mssql driver that is already a dependency of packages/api,
// but wires it through Knex for a query-builder API familiar to the rest of
// the longhaul migration.
//
// The tenant's mssqlConnectionString (stored in the Neon tenants table) is
// parsed into Knex connection options. Connection strings follow the ADO.NET
// format: "Server=HOST;Database=DB;User Id=USER;Password=PASS;..."
// ---------------------------------------------------------------------------

import knex, { type Knex } from 'knex'
import { logger } from './logger'

const pools = new Map<string, Knex>()

/**
 * Parse an ADO.NET-style connection string into key/value pairs.
 * Keys are normalised to lowercase for lookup.
 */
function parseConnectionString(cs: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const part of cs.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim().toLowerCase()
    const value = part.slice(idx + 1).trim()
    if (key) result[key] = value
  }
  return result
}

/**
 * Returns a Knex instance for the given connection string.
 * Lazily creates and caches one pool per unique connection string.
 */
export function getLonghaulDb(connectionString: string): Knex {
  const existing = pools.get(connectionString)
  if (existing) return existing

  const parsed = parseConnectionString(connectionString)
  const server = parsed['server'] ?? parsed['data source'] ?? parsed['host']
  const database = parsed['database'] ?? parsed['initial catalog']
  const user = parsed['user id'] ?? parsed['uid'] ?? parsed['user']
  const password = parsed['password'] ?? parsed['pwd']
  const port = parseInt(parsed['port'] ?? '1433', 10)

  if (!server || !database || !user || !password) {
    throw new Error(
      'Invalid MSSQL connection string — must contain Server, Database, User Id, and Password.',
    )
  }

  logger.info('Opening longhaul Knex pool', { server, database })

  const instance = knex({
    client: 'mssql',
    connection: {
      server,
      port,
      user,
      password,
      database,
      options: {
        encrypt: parsed['encrypt']?.toLowerCase() !== 'false',
        trustServerCertificate: parsed['trustservercertificate']?.toLowerCase() !== 'false',
      },
    },
    pool: { min: 0, max: 10 },
  })

  pools.set(connectionString, instance)
  return instance
}

/**
 * Closes all cached Knex pools. Called during graceful shutdown.
 */
export async function closeAllLonghaulPools(): Promise<void> {
  for (const [key, instance] of pools) {
    await instance.destroy()
    pools.delete(key)
  }
}
