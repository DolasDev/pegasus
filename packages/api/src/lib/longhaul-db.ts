// ---------------------------------------------------------------------------
// Longhaul MSSQL connection — Knex singleton for on-prem SQL Server
//
// Uses the same mssql driver that is already a dependency of packages/api,
// but wires it through Knex for a query-builder API familiar to the rest of
// the longhaul migration.
//
// Environment variables required (all mandatory when longhaul routes are used):
//   MSSQL_HOST      — SQL Server hostname or IP
//   MSSQL_PORT      — SQL Server port (default: 1433)
//   MSSQL_USER      — SQL Server login username
//   MSSQL_PASSWORD  — SQL Server login password
//   MSSQL_DATABASE  — Database name
// ---------------------------------------------------------------------------

import knex, { type Knex } from 'knex'

let instance: Knex | null = null

/** Returns true if all required MSSQL env vars are present. */
export function longhaulDbConfigured(): boolean {
  return Boolean(
    process.env['MSSQL_HOST'] &&
    process.env['MSSQL_USER'] &&
    process.env['MSSQL_PASSWORD'] &&
    process.env['MSSQL_DATABASE'],
  )
}

/**
 * Returns the shared Knex instance for the longhaul on-prem SQL Server.
 * Lazily initialised on first call. Throws if configuration is missing.
 */
export function getLonghaulDb(): Knex {
  if (instance) return instance

  if (!longhaulDbConfigured()) {
    throw new Error(
      'Longhaul MSSQL connection is not configured. ' +
        'Set MSSQL_HOST, MSSQL_USER, MSSQL_PASSWORD, and MSSQL_DATABASE.',
    )
  }

  instance = knex({
    client: 'mssql',
    connection: {
      server: process.env['MSSQL_HOST']!,
      port: parseInt(process.env['MSSQL_PORT'] ?? '1433', 10),
      user: process.env['MSSQL_USER']!,
      password: process.env['MSSQL_PASSWORD']!,
      database: process.env['MSSQL_DATABASE']!,
      options: {
        encrypt: true,
        trustServerCertificate: true,
      },
    },
    pool: { min: 0, max: 10 },
  })

  return instance
}
