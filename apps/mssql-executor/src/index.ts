// ---------------------------------------------------------------------------
// VPC MSSQL executor Lambda.
//
// Lives in the WireGuard VPC's private-lambda subnet — its only outbound path
// is the route `10.200.0.0/16 → hub ENI`, so it can reach tenant MSSQL servers
// on overlay IPs. The main (public) API Lambda has no VPC attachment and
// cannot reach the overlay directly; migrated longhaul handlers author SQL,
// look up the tenant's connection string, and synchronously invoke this
// function to run the query.
//
// Payload (the invoke body):
//   { connectionString, sql, params?: { name, value }[], timeoutMs? }
//
// Response:
//   { ok: true, recordset, rowsAffected } | { ok: false, code, error }
//
// Connection pools are cached on the execution context keyed by connection
// string, so warm invocations skip the TDS handshake (Phase 0 measured
// ~80 ms warm vs ~626 ms cold). The connection string carries a password and
// is NEVER logged.
// ---------------------------------------------------------------------------

import sql from 'mssql'

export interface SqlParam {
  name: string
  value: unknown
}

export interface MssqlExecRequest {
  connectionString: string
  sql: string
  params?: SqlParam[]
  /** Per-query timeout in ms. Default 15_000. Hard ceiling is the Lambda timeout. */
  timeoutMs?: number
}

export type MssqlExecErrorCode = 'BAD_REQUEST' | 'QUERY_FAILED'

export type MssqlExecResponse =
  | { ok: true; recordset: unknown[]; rowsAffected: number[] }
  | { ok: false; code: MssqlExecErrorCode; error: string }

const DEFAULT_TIMEOUT_MS = 15_000

const pools = new Map<string, sql.ConnectionPool>()

async function getPool(connectionString: string): Promise<sql.ConnectionPool> {
  const existing = pools.get(connectionString)
  if (existing?.connected) return existing

  const pool = new sql.ConnectionPool(connectionString)
  pool.on('error', (err) => {
    log('error', 'mssql_pool_error', { error: err.message })
    pools.delete(connectionString)
  })
  await pool.connect()
  pools.set(connectionString, pool)
  return pool
}

export async function handler(event: MssqlExecRequest): Promise<MssqlExecResponse> {
  return execute(event)
}

/** Core logic — exported for unit tests that mock the `mssql` module. */
export async function execute(event: MssqlExecRequest): Promise<MssqlExecResponse> {
  if (!event?.connectionString || !event?.sql) {
    return { ok: false, code: 'BAD_REQUEST', error: 'missing required `connectionString` or `sql`' }
  }

  const startedAt = Date.now()
  try {
    const pool = await getPool(event.connectionString)
    const request = pool.request()
    ;(request as unknown as { timeout: number }).timeout = event.timeoutMs ?? DEFAULT_TIMEOUT_MS
    for (const p of event.params ?? []) request.input(p.name, p.value)

    const result = await request.query(event.sql)
    log('info', 'mssql_exec_ok', {
      durationMs: Date.now() - startedAt,
      rowCount: result.recordset?.length ?? 0,
    })
    return {
      ok: true,
      recordset: result.recordset ?? [],
      rowsAffected: result.rowsAffected ?? [],
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('error', 'mssql_exec_failed', { durationMs: Date.now() - startedAt, error: message })
    return { ok: false, code: 'QUERY_FAILED', error: message }
  }
}

function log(level: 'info' | 'error', event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, event, ...fields })
  if (level === 'error') {
    console.error(line)
  } else {
    console.log(line)
  }
}
