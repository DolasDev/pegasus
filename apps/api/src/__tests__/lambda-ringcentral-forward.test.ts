// Unit tests for the RingCentral on-prem forwarder cron.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  // Real subclass so `err instanceof MssqlExecError` branches in the handler fire.
  class MssqlExecError extends Error {
    constructor(
      public readonly code:
        | 'EXECUTOR_NOT_CONFIGURED'
        | 'EXECUTOR_INVOKE_FAILED'
        | 'EXECUTOR_QUERY_ERROR',
      message: string,
    ) {
      super(message)
      this.name = 'MssqlExecError'
    }
  }
  return {
    MssqlExecError,
    findMany: vi.fn(),
    executeSql: vi.fn(),
    buildInboundMessageMerge: vi.fn(),
    listPendingForwards: vi.fn(),
    markForwardSent: vi.fn(),
    markForwardFailed: vi.fn(),
    parkForward: vi.fn(),
  }
})
const { MssqlExecError } = h

vi.mock('../db', () => ({ db: { tenant: { findMany: h.findMany } } }))
vi.mock('../lib/mssql-executor-client', () => ({
  executeSql: h.executeSql,
  MssqlExecError: h.MssqlExecError,
}))
vi.mock('../services/ringcentral/onprem-merge', () => ({
  buildInboundMessageMerge: h.buildInboundMessageMerge,
}))
vi.mock('../repositories/messaging.repository', () => ({
  listPendingForwards: h.listPendingForwards,
  markForwardSent: h.markForwardSent,
  markForwardFailed: h.markForwardFailed,
  parkForward: h.parkForward,
}))

import { handler } from '../lambda-ringcentral-forward'

function outboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'obx-1',
    tenantId: 't1',
    attempts: 0,
    message: {
      id: 'msg-1',
      source: 'THREAD_STORE',
      externalId: 'ext-1',
      threadId: 'th-1',
      direction: 'INBOUND',
      fromNumber: '+15551112222',
      toNumber: '+15553334444',
      body: 'hello',
      rcCreationTime: new Date('2026-06-08T00:00:00Z'),
      rcLastModifiedTime: null,
    },
    ...overrides,
  }
}

beforeEach(() => {
  for (const v of Object.values(h)) {
    if (typeof v === 'function' && 'mockReset' in v) (v as ReturnType<typeof vi.fn>).mockReset()
  }
  h.buildInboundMessageMerge.mockReturnValue({ sql: 'MERGE ...', params: [] })
})

describe('lambda-ringcentral-forward', () => {
  it('no-ops on an empty outbox', async () => {
    h.listPendingForwards.mockResolvedValue([])
    await handler()
    expect(h.findMany).not.toHaveBeenCalled()
    expect(h.executeSql).not.toHaveBeenCalled()
  })

  it('forwards a pending message and marks it SENT with a purge window', async () => {
    h.listPendingForwards.mockResolvedValue([outboxRow()])
    h.findMany.mockResolvedValue([{ id: 't1', mssqlConnectionString: 'Server=onprem;' }])
    h.executeSql.mockResolvedValue({ recordset: [], recordsets: [], rowsAffected: [1] })

    await handler()

    expect(h.executeSql).toHaveBeenCalledWith('Server=onprem;', 'MERGE ...', { params: [] })
    expect(h.markForwardSent).toHaveBeenCalledTimes(1)
    const [, outboxId, messageId, purgeAfter] = h.markForwardSent.mock.calls[0]!
    expect(outboxId).toBe('obx-1')
    expect(messageId).toBe('msg-1')
    expect(purgeAfter).toBeInstanceOf(Date)
    expect((purgeAfter as Date).getTime()).toBeGreaterThan(Date.now())
    expect(h.markForwardFailed).not.toHaveBeenCalled()
  })

  it('parks (does not fail) when the tenant has no on-prem connection string', async () => {
    h.listPendingForwards.mockResolvedValue([outboxRow()])
    h.findMany.mockResolvedValue([{ id: 't1', mssqlConnectionString: null }])

    await handler()

    expect(h.executeSql).not.toHaveBeenCalled()
    expect(h.parkForward).toHaveBeenCalledTimes(1)
    expect(h.markForwardFailed).not.toHaveBeenCalled()
  })

  it('parks (no attempt consumed) when the on-prem side is unreachable', async () => {
    h.listPendingForwards.mockResolvedValue([outboxRow({ attempts: 3 })])
    h.findMany.mockResolvedValue([{ id: 't1', mssqlConnectionString: 'Server=onprem;' }])
    h.executeSql.mockRejectedValue(new MssqlExecError('EXECUTOR_INVOKE_FAILED', 'tunnel down'))

    await handler()

    expect(h.parkForward).toHaveBeenCalledTimes(1)
    expect(h.markForwardFailed).not.toHaveBeenCalled()
  })

  it('records a FAILED attempt with backoff on a genuine query error', async () => {
    h.listPendingForwards.mockResolvedValue([outboxRow({ attempts: 1 })])
    h.findMany.mockResolvedValue([{ id: 't1', mssqlConnectionString: 'Server=onprem;' }])
    h.executeSql.mockRejectedValue(new MssqlExecError('EXECUTOR_QUERY_ERROR', 'bad merge'))

    await handler()

    expect(h.parkForward).not.toHaveBeenCalled()
    expect(h.markForwardFailed).toHaveBeenCalledTimes(1)
    const [, , , args] = h.markForwardFailed.mock.calls[0]!
    expect(args).toMatchObject({ nextStatus: 'FAILED', error: 'bad merge' })
    expect((args as { nextAttemptAt: Date }).nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('dead-letters a row once retries are exhausted', async () => {
    // attempts 7 → this is the 8th (MAX_ATTEMPTS) attempt → DEAD.
    h.listPendingForwards.mockResolvedValue([outboxRow({ attempts: 7 })])
    h.findMany.mockResolvedValue([{ id: 't1', mssqlConnectionString: 'Server=onprem;' }])
    h.executeSql.mockRejectedValue(new MssqlExecError('EXECUTOR_QUERY_ERROR', 'still bad'))

    await handler()

    const [, , , args] = h.markForwardFailed.mock.calls[0]!
    expect(args).toMatchObject({ nextStatus: 'DEAD' })
  })

  it('isolates a per-row failure and continues with the rest', async () => {
    h.listPendingForwards.mockResolvedValue([
      outboxRow({ id: 'obx-1', message: { ...outboxRow().message, id: 'msg-1' } }),
      outboxRow({
        id: 'obx-2',
        message: { ...outboxRow().message, id: 'msg-2', externalId: 'ext-2' },
      }),
    ])
    h.findMany.mockResolvedValue([{ id: 't1', mssqlConnectionString: 'Server=onprem;' }])
    h.executeSql
      .mockRejectedValueOnce(new MssqlExecError('EXECUTOR_QUERY_ERROR', 'boom'))
      .mockResolvedValueOnce({ recordset: [], recordsets: [], rowsAffected: [1] })

    await handler()

    expect(h.executeSql).toHaveBeenCalledTimes(2) // did not abort after the first row
    expect(h.markForwardFailed).toHaveBeenCalledTimes(1)
    expect(h.markForwardSent).toHaveBeenCalledTimes(1)
  })
})
