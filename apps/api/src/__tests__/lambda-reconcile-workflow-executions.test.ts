// ---------------------------------------------------------------------------
// Unit tests for the workflow-execution reconcile poller.
//
// Verifies the crash-recovery backstop:
//   - a stale RUNNING row whose Temporal run is terminal flips to the mapped
//     terminal status (COMPLETED / FAILED / CANCELLED for TERMINATED /
//     TIMED_OUT), with result / errorMessage carried over
//   - the 5-minute grace window is expressed in the query (fresh rows are
//     never even fetched)
//   - the idempotent write only touches rows still RUNNING (updateMany with a
//     status:'RUNNING' predicate), so a worker write-back that won the race is
//     not clobbered and no metric is emitted
//   - a row still RUNNING on Temporal's side is left alone
//
// Temporal is injected via _setTemporalClientForTesting (the real client
// module's test hook) so no gRPC connection is opened; `../db` and the
// CloudWatch SDK are mocked.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Client } from '@temporalio/client'
import { _setTemporalClientForTesting } from '../lib/temporal-client'

const { mockSend, putMetricDataInputs, mockFindMany, mockUpdateMany } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  putMetricDataInputs: [] as unknown[],
  mockFindMany: vi.fn(),
  mockUpdateMany: vi.fn(),
}))

vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: class {
    send = mockSend
  },
  PutMetricDataCommand: class {
    public input: unknown
    constructor(input: unknown) {
      this.input = input
      putMetricDataInputs.push(input)
    }
  },
}))

vi.mock('../db', () => ({
  db: {
    workflowExecution: {
      findMany: mockFindMany,
      updateMany: mockUpdateMany,
    },
  },
}))

import { handler } from '../lambda-reconcile-workflow-executions'

// ── Helpers ──────────────────────────────────────────────────────────────

const now = new Date('2026-06-09T12:00:00.000Z')
const stale = new Date(now.getTime() - 10 * 60 * 1000) // 10m ago — past grace

function runningRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exec-1',
    tenantId: 'tenant-1',
    workflowId: 'wf-1',
    status: 'RUNNING',
    input: {},
    result: null,
    errorMessage: null,
    temporalWorkflowId: 'wf/tenant-1/send_quote_followup/exec-1',
    temporalRunId: 'run-1',
    triggeredByUserId: 'user-1',
    queuedAt: stale,
    startedAt: stale,
    finishedAt: null,
    createdAt: stale,
    updatedAt: stale,
    ...overrides,
  }
}

/**
 * Build a fake Temporal Client whose getHandle returns a handle reporting the
 * given status. `resultValue` resolves from `.result()` (COMPLETED); for a
 * FAILED run, `resultError` is thrown instead.
 */
function fakeClient(opts: {
  statusName: string
  resultValue?: unknown
  resultError?: Error
}): Client {
  const handle = {
    describe: vi.fn().mockResolvedValue({ status: { name: opts.statusName } }),
    result: vi.fn(async () => {
      if (opts.resultError) throw opts.resultError
      return opts.resultValue
    }),
  }
  return {
    workflow: {
      getHandle: vi.fn(() => handle),
    },
  } as unknown as Client
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  mockSend.mockReset().mockResolvedValue({})
  putMetricDataInputs.length = 0
  mockFindMany.mockReset()
  mockUpdateMany.mockReset().mockResolvedValue({ count: 1 })
  _setTemporalClientForTesting(null)
})

// ── Tests ────────────────────────────────────────────────────────────────

describe('lambda-reconcile-workflow-executions', () => {
  it('queries only RUNNING rows older than the 5-minute grace window', async () => {
    mockFindMany.mockResolvedValue([])

    await handler()

    expect(mockFindMany).toHaveBeenCalledTimes(1)
    const arg = mockFindMany.mock.calls[0]![0] as {
      where: { status: string; startedAt: { lt: Date } }
      take: number
      orderBy: { startedAt: string }
    }
    expect(arg.where.status).toBe('RUNNING')
    expect(arg.take).toBe(100)
    expect(arg.orderBy).toEqual({ startedAt: 'asc' })
    // cutoff = now - 5m
    expect(arg.where.startedAt.lt.getTime()).toBe(now.getTime() - 5 * 60 * 1000)
  })

  it('does nothing (no Temporal call, no write) when there are no orphans', async () => {
    mockFindMany.mockResolvedValue([])
    // Inject a client that would throw if touched.
    _setTemporalClientForTesting(fakeClient({ statusName: 'COMPLETED' }))

    const out = await handler()

    expect(out).toEqual({ scanned: 0, reconciled: 0 })
    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('flips a stale RUNNING row to COMPLETED and carries the result', async () => {
    mockFindMany.mockResolvedValue([runningRow()])
    _setTemporalClientForTesting(
      fakeClient({ statusName: 'COMPLETED', resultValue: { ok: true } }),
    )

    const out = await handler()

    expect(out).toEqual({ scanned: 1, reconciled: 1 })
    expect(mockUpdateMany).toHaveBeenCalledTimes(1)
    const arg = mockUpdateMany.mock.calls[0]![0] as {
      where: { id: string; status: string }
      data: { status: string; finishedAt: Date; result?: unknown; errorMessage?: string }
    }
    // Idempotent predicate: only flips rows still RUNNING.
    expect(arg.where).toEqual({ id: 'exec-1', status: 'RUNNING' })
    expect(arg.data.status).toBe('COMPLETED')
    expect(arg.data.finishedAt).toBeInstanceOf(Date)
    expect(arg.data.result).toEqual({ ok: true })
    expect(arg.data.errorMessage).toBeUndefined()
  })

  it('flips a FAILED run and records the failure message', async () => {
    mockFindMany.mockResolvedValue([runningRow()])
    const failure = new Error('Workflow execution failed')
    ;(failure as Error & { cause?: Error }).cause = new Error('boom in activity')
    _setTemporalClientForTesting(fakeClient({ statusName: 'FAILED', resultError: failure }))

    const out = await handler()

    expect(out.reconciled).toBe(1)
    const arg = mockUpdateMany.mock.calls[0]![0] as {
      data: { status: string; errorMessage?: string }
    }
    expect(arg.data.status).toBe('FAILED')
    expect(arg.data.errorMessage).toBe('Workflow execution failed: boom in activity')
  })

  it('maps Temporal TERMINATED -> CANCELLED and TIMED_OUT -> TIMED_OUT', async () => {
    mockFindMany.mockResolvedValue([runningRow()])

    _setTemporalClientForTesting(fakeClient({ statusName: 'TERMINATED' }))
    await handler()
    expect(
      (mockUpdateMany.mock.calls[0]![0] as { data: { status: string } }).data.status,
    ).toBe('CANCELLED')

    mockUpdateMany.mockClear()
    _setTemporalClientForTesting(fakeClient({ statusName: 'TIMED_OUT' }))
    await handler()
    expect(
      (mockUpdateMany.mock.calls[0]![0] as { data: { status: string } }).data.status,
    ).toBe('TIMED_OUT')
  })

  it('leaves a row alone when Temporal still reports RUNNING', async () => {
    mockFindMany.mockResolvedValue([runningRow()])
    _setTemporalClientForTesting(fakeClient({ statusName: 'RUNNING' }))

    const out = await handler()

    expect(out.reconciled).toBe(0)
    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('is idempotent — a row already terminal (write-back raced) emits no metric', async () => {
    mockFindMany.mockResolvedValue([runningRow()])
    // The conditional updateMany matched zero rows: the worker beat us to it.
    mockUpdateMany.mockResolvedValue({ count: 0 })
    _setTemporalClientForTesting(
      fakeClient({ statusName: 'COMPLETED', resultValue: { ok: true } }),
    )

    const out = await handler()

    expect(out.reconciled).toBe(0)
    expect(mockUpdateMany).toHaveBeenCalledTimes(1)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('emits WorkflowExecutionReconciled with a Status dimension', async () => {
    mockFindMany.mockResolvedValue([runningRow()])
    _setTemporalClientForTesting(
      fakeClient({ statusName: 'COMPLETED', resultValue: { ok: true } }),
    )

    await handler()

    expect(putMetricDataInputs).toHaveLength(1)
    const input = putMetricDataInputs[0] as {
      Namespace: string
      MetricData: Array<{
        MetricName: string
        Value: number
        Unit: string
        Dimensions: Array<{ Name: string; Value: string }>
      }>
    }
    expect(input.Namespace).toBe('Pegasus/Workflows')
    expect(input.MetricData[0]!.MetricName).toBe('WorkflowExecutionReconciled')
    expect(input.MetricData[0]!.Dimensions).toEqual([{ Name: 'Status', Value: 'COMPLETED' }])
  })

  it('skips a RUNNING row with no temporalWorkflowId (cannot address the run)', async () => {
    mockFindMany.mockResolvedValue([runningRow({ temporalWorkflowId: null })])
    _setTemporalClientForTesting(fakeClient({ statusName: 'COMPLETED' }))

    const out = await handler()

    expect(out.reconciled).toBe(0)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('one bad row does not abort the tick — the next row still reconciles', async () => {
    mockFindMany.mockResolvedValue([
      runningRow({ id: 'exec-bad', temporalWorkflowId: 'wf/bad' }),
      runningRow({ id: 'exec-good', temporalWorkflowId: 'wf/good' }),
    ])
    const handles: Record<string, unknown> = {
      'wf/bad': {
        describe: vi.fn().mockRejectedValue(new Error('workflow not found')),
        result: vi.fn(),
      },
      'wf/good': {
        describe: vi.fn().mockResolvedValue({ status: { name: 'COMPLETED' } }),
        result: vi.fn().mockResolvedValue({ ok: true }),
      },
    }
    _setTemporalClientForTesting({
      workflow: { getHandle: vi.fn((id: string) => handles[id]) },
    } as unknown as Client)

    const out = await handler()

    expect(out).toEqual({ scanned: 2, reconciled: 1 })
    expect(mockUpdateMany).toHaveBeenCalledTimes(1)
    expect((mockUpdateMany.mock.calls[0]![0] as { where: { id: string } }).where.id).toBe(
      'exec-good',
    )
  })
})
