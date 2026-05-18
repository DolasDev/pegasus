// ---------------------------------------------------------------------------
// Phase 0 feasibility diagnostic — TEMPORARY tooling.
//
// A one-shot Lambda that opens a raw `mssql` TCP connection to a tenant's
// MSSQL over the WireGuard overlay and runs `SELECT 1`, timing the connect
// and query phases separately. It proves Phase 0 of the longhaul strangler-fig
// migration (plans/in-progress/longhaul-strangler-fig-cloud-migration.md):
// that a VPC-attached cloud Lambda can reach tenant MSSQL at all, and how
// cold vs warm latency compares once getPool() caches the connection pool.
//
// It has no event source — invoke it by hand:
//   aws lambda invoke --function-name <MssqlDiagnosticFnName> \
//     --payload '{"connectionString":"...","label":"cold"}' out.json
//
// The diagnostic runs in a PRIVATE_ISOLATED subnet with no internet egress
// and no CloudWatch VPC endpoint, so neither metrics nor logs reliably reach
// CloudWatch from here. The **invocation response payload** (captured in
// out.json) is the measurement channel. Remove this file and its CDK
// construct in wireguard-stack.ts once the Phase 0 numbers are recorded.
// ---------------------------------------------------------------------------

import { getPool } from './lib/mssql'
import { createLogger } from './lib/logger'

const logger = createLogger('longhaul-mssql-diagnostic')

// Module-level flag — true only on a fresh (cold) execution context, flipped
// false after the first invocation so warm reinvokes report coldStart: false.
let isCold = true

export interface DiagnosticEvent {
  connectionString?: string
  label?: string
}

export interface DiagnosticResult {
  ok: boolean
  coldStart: boolean
  poolWasCached: boolean
  connectMs: number
  queryMs: number
  totalMs: number
  label: string
  recordset?: unknown
  error?: string
}

export async function handler(event: DiagnosticEvent): Promise<DiagnosticResult> {
  const coldStart = isCold
  isCold = false
  const label = event.label ?? 'unlabelled'

  if (!event.connectionString) {
    throw new Error('connectionString is required in the invocation payload')
  }

  const started = Date.now()
  let connectMs = 0
  let queryMs = 0
  try {
    // getPool() caches connected pools in a module-level Map keyed by the
    // connection string. A cold invocation pays the full TDS handshake here;
    // a warm reinvocation with the same string returns the cached pool almost
    // instantly — connectMs is the signal that tells the two apart.
    const connectStart = Date.now()
    const pool = await getPool(event.connectionString)
    connectMs = Date.now() - connectStart

    const queryStart = Date.now()
    const result = await pool.request().query('SELECT 1 AS n')
    queryMs = Date.now() - queryStart
    const totalMs = Date.now() - started

    const diagnostic: DiagnosticResult = {
      ok: true,
      coldStart,
      poolWasCached: connectMs < 5,
      connectMs,
      queryMs,
      totalMs,
      label,
      recordset: result.recordset,
    }
    logger.info('longhaul mssql diagnostic ok', { ...diagnostic, recordset: undefined })
    return diagnostic
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const totalMs = Date.now() - started
    logger.error('longhaul mssql diagnostic failed', { error: message, coldStart, label, totalMs })
    return {
      ok: false,
      coldStart,
      poolWasCached: false,
      connectMs,
      queryMs,
      totalMs,
      label,
      error: message,
    }
  }
}
