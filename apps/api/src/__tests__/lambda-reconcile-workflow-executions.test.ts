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
import {
  _setTemporalClientForTesting,
  _setTenantTemporalDepsForTesting,
} from '../lib/temporal-client'

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

// The handler queries two lanes (Phase 3c); route the mock by the lane's kind.
let automationLane: unknown[] = []
let workflowLane: unknown[] = []
function setAutomationLane(rows: unknown[]): void {
  automationLane = rows
}
function setWorkflowLane(rows: unknown[]): void {
  workflowLane = rows
}

beforeEach(() => {
  automationLane = []
  workflowLane = []
  vi.useFakeTimers()
  vi.setSystemTime(now)
  mockSend.mockReset().mockResolvedValue({})
  putMetricDataInputs.length = 0
  mockFindMany
    .mockReset()
    .mockImplementation(async (args: { where: { workflow: { kind: string } } }) =>
      args.where.workflow.kind === 'WORKFLOW' ? workflowLane : automationLane,
    )
  mockUpdateMany.mockReset().mockResolvedValue({ count: 1 })
  _setTemporalClientForTesting(null)
})

// ── Tests ────────────────────────────────────────────────────────────────

describe('lambda-reconcile-workflow-executions', () => {
  it('queries only RUNNING rows older than the 5-minute grace window', async () => {
    setAutomationLane([])

    await handler()

    // Two lanes (Phase 3c); this is the AUTOMATION one.
    expect(mockFindMany).toHaveBeenCalledTimes(2)
    const arg = mockFindMany.mock.calls[0]![0] as {
      where: { status: string; startedAt: { lt: Date }; workflow: { kind: string } }
      take: number
      orderBy: { startedAt: string }
    }
    expect(arg.where.workflow).toEqual({ kind: 'AUTOMATION' })
    expect(arg.where.status).toBe('RUNNING')
    expect(arg.take).toBe(100)
    expect(arg.orderBy).toEqual({ startedAt: 'asc' })
    // cutoff = now - 5m
    expect(arg.where.startedAt.lt.getTime()).toBe(now.getTime() - 5 * 60 * 1000)
  })

  it('does nothing (no Temporal call, no write) when there are no orphans', async () => {
    setAutomationLane([])
    // Inject a client that would throw if touched.
    _setTemporalClientForTesting(fakeClient({ statusName: 'COMPLETED' }))

    const out = await handler()

    expect(out).toEqual({ scanned: 0, reconciled: 0 })
    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('flips a stale RUNNING row to COMPLETED and carries the result', async () => {
    setAutomationLane([runningRow()])
    _setTemporalClientForTesting(fakeClient({ statusName: 'COMPLETED', resultValue: { ok: true } }))

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
    setAutomationLane([runningRow()])
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
    setAutomationLane([runningRow()])

    _setTemporalClientForTesting(fakeClient({ statusName: 'TERMINATED' }))
    await handler()
    expect((mockUpdateMany.mock.calls[0]![0] as { data: { status: string } }).data.status).toBe(
      'CANCELLED',
    )

    mockUpdateMany.mockClear()
    _setTemporalClientForTesting(fakeClient({ statusName: 'TIMED_OUT' }))
    await handler()
    expect((mockUpdateMany.mock.calls[0]![0] as { data: { status: string } }).data.status).toBe(
      'TIMED_OUT',
    )
  })

  it('leaves a row alone when Temporal still reports RUNNING', async () => {
    setAutomationLane([runningRow()])
    _setTemporalClientForTesting(fakeClient({ statusName: 'RUNNING' }))

    const out = await handler()

    expect(out.reconciled).toBe(0)
    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('is idempotent — a row already terminal (write-back raced) emits no metric', async () => {
    setAutomationLane([runningRow()])
    // The conditional updateMany matched zero rows: the worker beat us to it.
    mockUpdateMany.mockResolvedValue({ count: 0 })
    _setTemporalClientForTesting(fakeClient({ statusName: 'COMPLETED', resultValue: { ok: true } }))

    const out = await handler()

    expect(out.reconciled).toBe(0)
    expect(mockUpdateMany).toHaveBeenCalledTimes(1)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('emits WorkflowExecutionReconciled with a Status dimension', async () => {
    setAutomationLane([runningRow()])
    _setTemporalClientForTesting(fakeClient({ statusName: 'COMPLETED', resultValue: { ok: true } }))

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
    setAutomationLane([runningRow({ temporalWorkflowId: null })])
    _setTemporalClientForTesting(fakeClient({ statusName: 'COMPLETED' }))

    const out = await handler()

    expect(out.reconciled).toBe(0)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('one bad row does not abort the tick — the next row still reconciles', async () => {
    setAutomationLane([
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

describe('tenant namespaces (3b.2)', () => {
  const NS = 'pg-test-tenant1.acct'

  it('asks the namespace recorded on the row, with that tenant’s key', async () => {
    const shared = fakeClient({ statusName: 'RUNNING' })
    _setTemporalClientForTesting(shared)
    const tenantClient = fakeClient({ statusName: 'COMPLETED', resultValue: { ok: true } })
    const loadKey = vi.fn(async () => ({
      namespace: NS,
      grpcAddress: `${NS}.tmprl.cloud:7233`,
      apiKeyId: 'k1',
      apiKey: 'secret',
    }))
    const connect = vi.fn(async () => ({ client: tenantClient, close: vi.fn(async () => {}) }))
    _setTenantTemporalDepsForTesting({ loadKey, connect })
    try {
      setAutomationLane([runningRow({ temporalNamespace: NS })])

      const out = await handler()

      expect(out.reconciled).toBe(1)
      expect(loadKey).toHaveBeenCalledWith('tenant-1')
      expect(shared.workflow.getHandle).not.toHaveBeenCalled()
      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED', result: { ok: true } }),
        }),
      )
    } finally {
      _setTenantTemporalDepsForTesting(null)
    }
  })

  it('a key failure on one row skips it and the tick goes on', async () => {
    _setTemporalClientForTesting(fakeClient({ statusName: 'FAILED', resultError: new Error('x') }))
    _setTenantTemporalDepsForTesting({ loadKey: vi.fn(async () => null) })
    try {
      setAutomationLane([
        runningRow({ id: 'exec-tenant', temporalNamespace: NS }),
        runningRow({ id: 'exec-shared' }),
      ])

      const out = await handler()

      expect(out).toEqual({ scanned: 2, reconciled: 1 })
    } finally {
      _setTenantTemporalDepsForTesting(null)
    }
  })
})

// ── Durable Workflows: the WORKFLOW lane (Phase 3c) ────────────────────────

describe('WORKFLOW lane (Phase 3c)', () => {
  it('queries durable rows round-robin on reconciledAt, never-checked first', async () => {
    await handler()
    const arg = mockFindMany.mock.calls[1]![0] as {
      where: { status: string; startedAt: { lt: Date }; workflow: { kind: string } }
      take: number
      orderBy: unknown
    }
    expect(arg.where).toEqual({
      status: 'RUNNING',
      startedAt: { lt: new Date(now.getTime() - 5 * 60 * 1000) },
      workflow: { kind: 'WORKFLOW' },
    })
    expect(arg.take).toBe(100)
    expect(arg.orderBy).toEqual({ reconciledAt: { sort: 'asc', nulls: 'first' } })
  })

  it('a full WORKFLOW lane never starves the AUTOMATION lane', async () => {
    // 100 open durable Workflows plus one orphaned Automation: the Automation
    // still gets its check (before 3c, one global oldest-first batch of 100
    // would have held only the long-lived rows).
    setWorkflowLane(
      Array.from({ length: 100 }, (_, i) =>
        runningRow({ id: `wfl-${i}`, temporalWorkflowId: `wf/t/lifecycle/wfl-${i}` }),
      ),
    )
    setAutomationLane([runningRow({ id: 'auto-1' })])
    const client = {
      workflow: {
        getHandle: vi.fn((id: string) => ({
          describe: vi.fn().mockResolvedValue({
            status: { name: id.includes('lifecycle') ? 'RUNNING' : 'COMPLETED' },
          }),
          result: vi.fn().mockResolvedValue(null),
        })),
      },
    } as unknown as Client
    _setTemporalClientForTesting(client)

    const out = await handler()

    expect(out.reconciled).toBe(1)
    const flipped = mockUpdateMany.mock.calls
      .map((c) => c[0] as { where: { id: string }; data: { status?: string } })
      .filter((c) => c.data.status !== undefined)
    expect(flipped.map((c) => c.where.id)).toEqual(['auto-1'])
  })

  it('stamps reconciledAt on a still-running durable row (moves the round-robin)', async () => {
    setWorkflowLane([runningRow({ id: 'wfl-1' })])
    _setTemporalClientForTesting(fakeClient({ statusName: 'RUNNING' }))

    const out = await handler()

    expect(out.reconciled).toBe(0)
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'wfl-1', status: 'RUNNING' },
      data: { reconciledAt: now },
    })
  })

  it('closes a finished durable Workflow, stamped, as WorkflowExecutionClosed (not Reconciled)', async () => {
    setWorkflowLane([runningRow({ id: 'wfl-1' })])
    _setTemporalClientForTesting(fakeClient({ statusName: 'COMPLETED', resultValue: 'done' }))

    const out = await handler()

    expect(out.reconciled).toBe(1)
    const arg = mockUpdateMany.mock.calls[0]![0] as {
      data: { status: string; reconciledAt: Date; result: unknown }
    }
    expect(arg.data).toMatchObject({ status: 'COMPLETED', reconciledAt: now, result: 'done' })
    const names = putMetricDataInputs.flatMap(
      (p) => (p as { MetricData: Array<{ MetricName: string }> }).MetricData,
    )
    expect(names.every((m) => m.MetricName === 'WorkflowExecutionClosed')).toBe(true)
    expect(names.length).toBeGreaterThan(0)
  })

  it('stamps a durable row whose describe fails, so it cannot pin the batch', async () => {
    setWorkflowLane([runningRow({ id: 'wfl-1' })])
    const client = {
      workflow: {
        getHandle: vi.fn(() => ({ describe: vi.fn().mockRejectedValue(new Error('grpc down')) })),
      },
    } as unknown as Client
    _setTemporalClientForTesting(client)

    await handler()

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'wfl-1', status: 'RUNNING' },
      data: { reconciledAt: now },
    })
  })
})
