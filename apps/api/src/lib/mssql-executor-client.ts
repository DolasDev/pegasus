// ---------------------------------------------------------------------------
// MSSQL-executor client — runs SQL against a tenant's MSSQL by invoking the
// in-VPC mssql-executor Lambda (apps/mssql-executor).
//
// The main API Lambda runs in the public Lambda egress environment with no
// VPC attachment, so it cannot reach tenant MSSQL on the WireGuard overlay
// directly. Migrated longhaul handlers look up the tenant's connection string
// from Prisma, author raw SQL, and call executeSql() — which round-trips
// through the executor Lambda inside the WG VPC. This mirrors tunnel-client.ts.
// ---------------------------------------------------------------------------

import { LambdaClient, InvokeCommand, type LambdaClientConfig } from '@aws-sdk/client-lambda'
import { captureAWSv3Client } from 'aws-xray-sdk-core'
import { recordDownstream } from './request-timing'
import { withInvokeTimeout, invokeTimeoutMs, InvokeTimeoutError } from './invoke-timeout'

export class MssqlExecError extends Error {
  readonly code:
    | 'EXECUTOR_NOT_CONFIGURED'
    | 'EXECUTOR_INVOKE_FAILED'
    | 'EXECUTOR_INVOKE_TIMEOUT'
    | 'EXECUTOR_QUERY_ERROR'
  constructor(
    code:
      | 'EXECUTOR_NOT_CONFIGURED'
      | 'EXECUTOR_INVOKE_FAILED'
      | 'EXECUTOR_INVOKE_TIMEOUT'
      | 'EXECUTOR_QUERY_ERROR',
    message: string,
  ) {
    super(message)
    this.code = code
    this.name = 'MssqlExecError'
  }
}

export interface SqlParam {
  name: string
  value: unknown
}

interface ExecRequestPayload {
  connectionString: string
  sql: string
  params?: SqlParam[]
  timeoutMs?: number
}

type ExecResponsePayload =
  | {
      ok: true
      recordset: unknown[]
      /**
       * Per-statement result sets. For a single-statement query this is
       * `[recordset]`. Multi-statement batches use this to recover each
       * SELECT's rows individually (see longhaul-cloud/trip-detail).
       */
      recordsets?: unknown[][]
      rowsAffected: number[]
    }
  | { ok: false; code: 'BAD_REQUEST' | 'QUERY_FAILED'; error: string }

let _client: LambdaClient | null = null
function getClient(): LambdaClient {
  if (_client === null) {
    const config: LambdaClientConfig = {}
    const client = new LambdaClient(config)
    // In Lambda (where active X-Ray tracing guarantees a request segment) wrap
    // the client so each Invoke renders as its own X-Ray subsegment — making
    // the executor a visible edge on the service map. Skipped outside Lambda
    // (local dev, tests): there is no segment, and captureAWSv3Client would
    // otherwise raise the X-Ray "context missing" error on every call.
    _client = process.env['AWS_LAMBDA_FUNCTION_NAME'] ? captureAWSv3Client(client) : client
  }
  return _client
}

/** Override the LambdaClient. Tests inject a stub with a mocked `send`. */
export function setMssqlExecutorLambdaClient(client: LambdaClient | null): void {
  _client = client
}

export interface ExecuteSqlOptions {
  /** Named parameters bound via `request.input(name, value)` in the executor. */
  params?: SqlParam[]
  /** Per-query timeout in ms enforced by the executor Lambda. Default 15s. */
  timeoutMs?: number
}

export interface ExecuteSqlResult {
  /** First statement's rows. Convenient for single-statement queries. */
  recordset: unknown[]
  /**
   * Every statement's rows, in order. `[recordset]` for single-statement
   * queries. Multi-statement-batch handlers MUST read this rather than
   * `recordset` to recover their child collections.
   */
  recordsets: unknown[][]
  rowsAffected: number[]
}

/**
 * Run SQL against a tenant's MSSQL via the in-VPC executor Lambda. Throws
 * MssqlExecError on misconfiguration, invoke failure, or a query-level error.
 */
export async function executeSql(
  connectionString: string,
  sqlText: string,
  opts: ExecuteSqlOptions = {},
): Promise<ExecuteSqlResult> {
  const fnName = process.env['MSSQL_EXECUTOR_FUNCTION_NAME']
  if (!fnName) {
    throw new MssqlExecError(
      'EXECUTOR_NOT_CONFIGURED',
      'MSSQL_EXECUTOR_FUNCTION_NAME env var is not set — cannot run tenant SQL',
    )
  }

  const payload: ExecRequestPayload = {
    connectionString,
    sql: sqlText,
    ...(opts.params !== undefined ? { params: opts.params } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  }

  const res = await recordDownstream('mssql', () =>
    withInvokeTimeout(invokeTimeoutMs(opts.timeoutMs), (abortSignal) =>
      getClient().send(
        new InvokeCommand({
          FunctionName: fnName,
          InvocationType: 'RequestResponse',
          Payload: new TextEncoder().encode(JSON.stringify(payload)),
        }),
        { abortSignal },
      ),
    ),
  ).catch((err: unknown) => {
    if (err instanceof InvokeTimeoutError) {
      throw new MssqlExecError(
        'EXECUTOR_INVOKE_TIMEOUT',
        `mssql-executor invoke exceeded the ${err.timeoutMs}ms client-side timeout — ` +
          'the executor Lambda did not respond (cold start under the concurrency cap, ' +
          'throttle, or network), not a query-level error',
      )
    }
    throw err
  })

  if (res.FunctionError) {
    const errBody = res.Payload ? new TextDecoder().decode(res.Payload) : '<empty>'
    throw new MssqlExecError(
      'EXECUTOR_INVOKE_FAILED',
      `mssql-executor raised ${res.FunctionError}: ${errBody}`,
    )
  }
  if (!res.Payload) {
    throw new MssqlExecError('EXECUTOR_INVOKE_FAILED', 'mssql-executor returned empty payload')
  }

  const decoded = JSON.parse(new TextDecoder().decode(res.Payload)) as ExecResponsePayload
  if (!decoded.ok) {
    throw new MssqlExecError('EXECUTOR_QUERY_ERROR', `${decoded.code}: ${decoded.error}`)
  }
  // Older executor deployments only return `recordset`. During the rollout
  // window default `recordsets` to `[recordset]` so callers can rely on it.
  const recordsets = decoded.recordsets ?? (decoded.recordset ? [decoded.recordset] : [])
  return { recordset: decoded.recordset, recordsets, rowsAffected: decoded.rowsAffected }
}
