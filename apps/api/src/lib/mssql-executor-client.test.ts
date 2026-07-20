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
        Payload: encode({
          ok: true,
          recordset: recordsets[0],
          recordsets,
          rowsAffected: [1, 2, 1],
        }),
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

  it('throws EXECUTOR_INVOKE_TIMEOUT when a hung invoke exceeds the client ceiling', async () => {
    vi.useFakeTimers()
    // A client whose send only rejects when its abort signal fires (mirrors the
    // AWS SDK canceling an in-flight invoke), so the timeout path is exercised.
    const hung = {
      send: vi.fn(
        (_cmd: unknown, opts: { abortSignal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.abortSignal.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      ),
    } as unknown as LambdaClient
    setMssqlExecutorLambdaClient(hung)

    const p = executeSql('Server=a', 'SELECT 1', { timeoutMs: 10_000 })
    const assertion = expect(p).rejects.toMatchObject({ code: 'EXECUTOR_INVOKE_TIMEOUT' })
    // invokeTimeoutMs(10_000) = 14_000; advance past it.
    await vi.advanceTimersByTimeAsync(14_001)
    await assertion
    vi.useRealTimers()
  })

  it('forwards an abortSignal to the underlying send', async () => {
    const send = vi.fn(async (_cmd: unknown, opts: { abortSignal?: AbortSignal }) => {
      expect(opts.abortSignal).toBeInstanceOf(AbortSignal)
      return { Payload: encode({ ok: true, recordset: [], recordsets: [[]], rowsAffected: [] }) }
    })
    setMssqlExecutorLambdaClient({ send } as unknown as LambdaClient)
    await executeSql('Server=a', 'SELECT 1')
    expect(send).toHaveBeenCalledOnce()
  })
})
