import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { LambdaClient } from '@aws-sdk/client-lambda'
import { executeSql, setMssqlExecutorLambdaClient } from './mssql-executor-client'

function stubClient(impl: () => unknown): LambdaClient {
  return { send: vi.fn(async () => impl()) } as unknown as LambdaClient
}

function encode(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj))
}

describe('executeSql', () => {
  beforeEach(() => {
    process.env['MSSQL_EXECUTOR_FUNCTION_NAME'] = 'test-executor-fn'
  })
  afterEach(() => {
    setMssqlExecutorLambdaClient(null)
    delete process.env['MSSQL_EXECUTOR_FUNCTION_NAME']
  })

  it('returns the recordset on a successful invoke', async () => {
    setMssqlExecutorLambdaClient(
      stubClient(() => ({
        Payload: encode({
          ok: true,
          recordset: [{ max: '1.3.7' }],
          recordsets: [[{ max: '1.3.7' }]],
          rowsAffected: [1],
        }),
      })),
    )
    const res = await executeSql('Server=a,1433', 'SELECT 1')
    expect(res.recordset).toEqual([{ max: '1.3.7' }])
    expect(res.recordsets).toEqual([[{ max: '1.3.7' }]])
    expect(res.rowsAffected).toEqual([1])
  })

  it('passes through recordsets for a multi-statement batch', async () => {
    const recordsets = [[{ id: 1 }], [{ id: 2 }, { id: 3 }], [{ id: 4 }]]
    setMssqlExecutorLambdaClient(
      stubClient(() => ({
        Payload: encode({ ok: true, recordset: recordsets[0], recordsets, rowsAffected: [1, 2, 1] }),
      })),
    )
    const res = await executeSql('Server=a,1433', 'SELECT 1; SELECT 2; SELECT 3;')
    expect(res.recordsets).toEqual(recordsets)
  })

  it('back-fills recordsets from recordset when an older executor only returns recordset', async () => {
    // Rollout safety: the deployed executor may be on an older build that
    // does not yet emit `recordsets`. The client wraps `recordset` so that
    // callers can rely on `result.recordsets[0]`.
    setMssqlExecutorLambdaClient(
      stubClient(() => ({
        Payload: encode({ ok: true, recordset: [{ a: 1 }], rowsAffected: [1] }),
      })),
    )
    const res = await executeSql('Server=a,1433', 'SELECT 1')
    expect(res.recordsets).toEqual([[{ a: 1 }]])
  })

  it('throws EXECUTOR_NOT_CONFIGURED when the env var is missing', async () => {
    delete process.env['MSSQL_EXECUTOR_FUNCTION_NAME']
    await expect(executeSql('Server=a', 'SELECT 1')).rejects.toMatchObject({
      code: 'EXECUTOR_NOT_CONFIGURED',
    })
  })

  it('throws EXECUTOR_QUERY_ERROR when the executor reports a query failure', async () => {
    setMssqlExecutorLambdaClient(
      stubClient(() => ({
        Payload: encode({ ok: false, code: 'QUERY_FAILED', error: 'Invalid object name' }),
      })),
    )
    await expect(executeSql('Server=a', 'SELECT 1')).rejects.toMatchObject({
      code: 'EXECUTOR_QUERY_ERROR',
    })
  })

  it('throws EXECUTOR_INVOKE_FAILED on a Lambda FunctionError', async () => {
    setMssqlExecutorLambdaClient(
      stubClient(() => ({ FunctionError: 'Unhandled', Payload: encode({}) })),
    )
    await expect(executeSql('Server=a', 'SELECT 1')).rejects.toMatchObject({
      code: 'EXECUTOR_INVOKE_FAILED',
    })
  })
})
