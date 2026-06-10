// ---------------------------------------------------------------------------
// Unit tests for the workflow-trigger dispatcher poller (Phase 3 Unit 3).
//
// Verifies the outbox-drain contract:
//   - undispatched DomainEvent rows are read oldest-first, bounded at 100
//   - a matching enabled EVENT trigger starts an execution with EVENT
//     provenance, the deterministic Temporal id (persisted at create), and
//     REJECT_DUPLICATE — and the event is stamped dispatchedAt afterwards via
//     the conditional updateMany({ where: { id, dispatchedAt: null } })
//   - v1 filter semantics: shallow top-level strict equality; null/empty
//     filter matches all; a mismatch means no execution but still a stamp
//   - redelivery idempotency: an existing execution row with the same
//     deterministic temporalWorkflowId is skipped (no second row)
//   - failure isolation: one trigger's failure neither blocks the event's
//     other triggers nor the dispatchedAt stamp
//   - a non-executable workflow (pre-Track-A tenant upload) is a logged skip
//
// The shared run path (lib/start-workflow-execution.ts) runs for REAL against
// the mocked `../db`; Temporal is injected via _setTemporalClientForTesting
// so no gRPC connection is opened. The CloudWatch SDK is mocked.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Client } from '@temporalio/client'
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client'
import { _setTemporalClientForTesting } from '../lib/temporal-client'

const {
  mockSend,
  putMetricDataInputs,
  mockDomainEventFindMany,
  mockDomainEventUpdateMany,
  mockTriggerFindMany,
  mockWorkflowFindFirst,
  mockExecutionFindFirst,
  mockExecutionCreate,
  mockExecutionUpdate,
} = vi.hoisted(() => ({
  mockSend: vi.fn(),
  putMetricDataInputs: [] as unknown[],
  mockDomainEventFindMany: vi.fn(),
  mockDomainEventUpdateMany: vi.fn(),
  mockTriggerFindMany: vi.fn(),
  mockWorkflowFindFirst: vi.fn(),
  mockExecutionFindFirst: vi.fn(),
  mockExecutionCreate: vi.fn(),
  mockExecutionUpdate: vi.fn(),
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

vi.mock('../db', () => {
  const db = {
    domainEvent: {
      findMany: mockDomainEventFindMany,
      updateMany: mockDomainEventUpdateMany,
    },
    workflowTrigger: {
      findMany: mockTriggerFindMany,
    },
    workflow: {
      findFirst: mockWorkflowFindFirst,
    },
    workflowExecution: {
      findFirst: mockExecutionFindFirst,
      create: mockExecutionCreate,
      update: mockExecutionUpdate,
    },
    // The shared run path wraps its insert in a transaction; run the callback
    // against the same fake so the model mocks above resolve.
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(db)),
  }
  return { db }
})

import { handler, matchesTriggerFilter } from '../lambda-dispatch-workflow-triggers'

// ── Fixtures ─────────────────────────────────────────────────────────────

const now = new Date('2026-06-10T12:00:00.000Z')

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    tenantId: 'tenant-1',
    eventType: 'quote.accepted',
    payload: { quoteId: 'q-1', customerId: 'c-1' },
    occurredAt: now,
    dispatchedAt: null,
    ...overrides,
  }
}

function triggerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trg-1',
    tenantId: 'tenant-1',
    workflowId: 'wf-1',
    kind: 'EVENT',
    eventType: 'quote.accepted',
    filter: null,
    cronExpression: null,
    enabled: true,
    createdByUserId: 'user-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function workflowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf-1',
    tenantId: 'tenant-1',
    name: 'send_quote_followup',
    version: '1.0.0',
    visibility: 'TENANT',
    artifactKey: 'workflows/tenant-1/wf-1/1.0.0.zip',
    manifest: { name: 'send_quote_followup', version: '1.0.0' },
    createdByUserId: 'user-1',
    forkedFromWorkflowId: null,
    forkedFromVersion: null,
    runtimeTokenCiphertext: 'CIPHERTEXT',
    runtimeApiClientId: 'api-client-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const DETERMINISTIC_ID = 'wf/tenant-1/send_quote_followup/trg/trg-1/evt-1'

function queuedExecution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exec-1',
    tenantId: 'tenant-1',
    workflowId: 'wf-1',
    status: 'QUEUED',
    input: {},
    result: null,
    errorMessage: null,
    temporalWorkflowId: DETERMINISTIC_ID,
    temporalRunId: null,
    triggeredByUserId: null,
    triggerSource: 'EVENT',
    triggeredByTriggerId: 'trg-1',
    queuedAt: now,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function fakeTemporalClient(start: ReturnType<typeof vi.fn>): Client {
  return { workflow: { start } } as unknown as Client
}

/** Flattened MetricData entries across every PutMetricData call this tick. */
function emittedMetrics(): Array<{
  MetricName: string
  Value: number
  Dimensions?: Array<{ Name: string; Value: string }>
}> {
  return putMetricDataInputs.flatMap(
    (input) => (input as { MetricData: Array<{ MetricName: string; Value: number }> }).MetricData,
  ) as ReturnType<typeof emittedMetrics>
}

beforeEach(() => {
  vi.clearAllMocks()
  putMetricDataInputs.length = 0
  mockSend.mockResolvedValue({})
  mockDomainEventFindMany.mockResolvedValue([])
  mockDomainEventUpdateMany.mockResolvedValue({ count: 1 })
  mockTriggerFindMany.mockResolvedValue([])
  mockWorkflowFindFirst.mockResolvedValue(workflowRow())
  mockExecutionFindFirst.mockResolvedValue(null)
  mockExecutionCreate.mockResolvedValue(queuedExecution())
  mockExecutionUpdate.mockResolvedValue(queuedExecution({ status: 'RUNNING', startedAt: now }))
  const start = vi.fn().mockResolvedValue({
    workflowId: DETERMINISTIC_ID,
    firstExecutionRunId: 'run-1',
  })
  _setTemporalClientForTesting(fakeTemporalClient(start))
})

// ── matchesTriggerFilter (v1 public contract) ────────────────────────────

describe('matchesTriggerFilter', () => {
  it('null / empty filters match everything', () => {
    expect(matchesTriggerFilter(null, { a: 1 })).toBe(true)
    expect(matchesTriggerFilter({}, { a: 1 })).toBe(true)
  })

  it('matches on shallow top-level strict equality of every filter key', () => {
    expect(matchesTriggerFilter({ a: 1 }, { a: 1, b: 2 })).toBe(true)
    expect(matchesTriggerFilter({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
    expect(matchesTriggerFilter({ a: 1, b: 3 }, { a: 1, b: 2 })).toBe(false)
    expect(matchesTriggerFilter({ a: '1' }, { a: 1 })).toBe(false) // strict — no coercion
    expect(matchesTriggerFilter({ missing: true }, { a: 1 })).toBe(false)
  })

  it('object/array filter values never match in v1 (strict equality only)', () => {
    expect(matchesTriggerFilter({ a: { nested: 1 } }, { a: { nested: 1 } })).toBe(false)
  })

  it('a non-empty filter never matches a non-object payload', () => {
    expect(matchesTriggerFilter({ a: 1 }, 'scalar-payload')).toBe(false)
    expect(matchesTriggerFilter(null, 'scalar-payload')).toBe(true)
  })
})

// ── Handler ──────────────────────────────────────────────────────────────

describe('lambda-dispatch-workflow-triggers', () => {
  it('queries undispatched events oldest-first, bounded at 100', async () => {
    await handler()

    expect(mockDomainEventFindMany).toHaveBeenCalledWith({
      where: { dispatchedAt: null },
      orderBy: { occurredAt: 'asc' },
      take: 100,
    })
  })

  it('does nothing (no trigger query, no metric) when there are no events', async () => {
    const out = await handler()

    expect(out).toEqual({ scanned: 0, dispatched: 0, fired: 0 })
    expect(mockTriggerFindMany).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('fires a matching trigger: EVENT provenance, deterministic Temporal id, stamped event', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    mockTriggerFindMany.mockResolvedValue([triggerRow()])

    const out = await handler()

    expect(out).toEqual({ scanned: 1, dispatched: 1, fired: 1 })

    // Only enabled EVENT triggers of this (tenant, eventType) are considered.
    expect(mockTriggerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          kind: 'EVENT',
          enabled: true,
          eventType: 'quote.accepted',
          tenantId: 'tenant-1',
        },
      }),
    )

    // Execution row carries EVENT provenance + the deterministic id AT CREATE.
    expect(mockExecutionCreate).toHaveBeenCalledTimes(1)
    const createArg = mockExecutionCreate.mock.calls[0]![0] as {
      data: Record<string, unknown>
    }
    expect(createArg.data).toMatchObject({
      tenantId: 'tenant-1',
      workflowId: 'wf-1',
      status: 'QUEUED',
      triggeredByUserId: null,
      triggerSource: 'EVENT',
      triggeredByTriggerId: 'trg-1',
      temporalWorkflowId: DETERMINISTIC_ID,
    })
    // The input is the event envelope.
    expect(createArg.data['input']).toEqual({
      domainEventId: 'evt-1',
      eventType: 'quote.accepted',
      occurredAt: now.toISOString(),
      payload: { quoteId: 'q-1', customerId: 'c-1' },
    })

    // dispatchedAt stamped conditionally (idempotent against concurrent ticks).
    expect(mockDomainEventUpdateMany).toHaveBeenCalledWith({
      where: { id: 'evt-1', dispatchedAt: null },
      data: { dispatchedAt: expect.any(Date) },
    })

    const metrics = emittedMetrics()
    expect(metrics).toContainEqual(
      expect.objectContaining({ MetricName: 'DomainEventsDispatched', Value: 1 }),
    )
    expect(metrics).toContainEqual(
      expect.objectContaining({ MetricName: 'WorkflowTriggerFired', Value: 1 }),
    )
  })

  it('starts Temporal with the deterministic id and REJECT_DUPLICATE', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    mockTriggerFindMany.mockResolvedValue([triggerRow()])
    const start = vi.fn().mockResolvedValue({
      workflowId: DETERMINISTIC_ID,
      firstExecutionRunId: 'run-1',
    })
    _setTemporalClientForTesting(fakeTemporalClient(start))

    await handler()

    expect(start).toHaveBeenCalledWith(
      'send_quote_followup',
      expect.objectContaining({
        workflowId: DETERMINISTIC_ID,
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
      }),
    )
  })

  it('filter mismatch: no execution, event still stamped', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    mockTriggerFindMany.mockResolvedValue([triggerRow({ filter: { quoteId: 'other' } })])

    const out = await handler()

    expect(out).toEqual({ scanned: 1, dispatched: 1, fired: 0 })
    expect(mockExecutionCreate).not.toHaveBeenCalled()
    expect(mockDomainEventUpdateMany).toHaveBeenCalledTimes(1)
  })

  it('filter match (shallow equality) fires the trigger', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    mockTriggerFindMany.mockResolvedValue([triggerRow({ filter: { quoteId: 'q-1' } })])

    const out = await handler()

    expect(out.fired).toBe(1)
  })

  it('duplicate redelivery: an existing row with the deterministic id is skipped', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    mockTriggerFindMany.mockResolvedValue([triggerRow()])
    mockExecutionFindFirst.mockResolvedValue({ id: 'exec-existing' })

    const out = await handler()

    expect(out).toEqual({ scanned: 1, dispatched: 1, fired: 0 })
    expect(mockExecutionFindFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', temporalWorkflowId: DETERMINISTIC_ID },
      select: { id: true },
    })
    expect(mockExecutionCreate).not.toHaveBeenCalled()
    expect(mockDomainEventUpdateMany).toHaveBeenCalledTimes(1)
    expect(emittedMetrics()).toContainEqual(
      expect.objectContaining({
        MetricName: 'WorkflowTriggerSkipped',
        Value: 1,
        Dimensions: [{ Name: 'Reason', Value: 'DUPLICATE' }],
      }),
    )
  })

  it('non-executable workflow: logged skip, no FAILED row, event still stamped', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    mockTriggerFindMany.mockResolvedValue([triggerRow()])
    mockWorkflowFindFirst.mockResolvedValue(workflowRow({ name: 'tenant_custom_workflow' }))

    const out = await handler()

    expect(out).toEqual({ scanned: 1, dispatched: 1, fired: 0 })
    expect(mockExecutionCreate).not.toHaveBeenCalled()
    expect(mockDomainEventUpdateMany).toHaveBeenCalledTimes(1)
    expect(emittedMetrics()).toContainEqual(
      expect.objectContaining({
        MetricName: 'WorkflowTriggerSkipped',
        Dimensions: [{ Name: 'Reason', Value: 'NOT_EXECUTABLE' }],
      }),
    )
  })

  it('Temporal AlreadyStarted (pre-check raced): no FAILED row, event still stamped', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    mockTriggerFindMany.mockResolvedValue([triggerRow()])
    const start = vi
      .fn()
      .mockRejectedValue(
        new WorkflowExecutionAlreadyStartedError(
          'already started',
          DETERMINISTIC_ID,
          'send_quote_followup',
        ),
      )
    _setTemporalClientForTesting(fakeTemporalClient(start))

    const out = await handler()

    expect(out).toEqual({ scanned: 1, dispatched: 1, fired: 0 })
    // markTerminal would be an update with status FAILED — must not happen.
    expect(mockExecutionUpdate).not.toHaveBeenCalled()
    expect(mockDomainEventUpdateMany).toHaveBeenCalledTimes(1)
    expect(emittedMetrics()).toContainEqual(
      expect.objectContaining({
        MetricName: 'WorkflowTriggerSkipped',
        Dimensions: [{ Name: 'Reason', Value: 'ALREADY_STARTED' }],
      }),
    )
  })

  it('Temporal start failure: FAILED row recorded, event still stamped (no redelivery)', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    mockTriggerFindMany.mockResolvedValue([triggerRow()])
    const start = vi.fn().mockRejectedValue(new Error('temporal down'))
    _setTemporalClientForTesting(fakeTemporalClient(start))
    mockExecutionUpdate.mockResolvedValue(queuedExecution({ status: 'FAILED', finishedAt: now }))

    const out = await handler()

    expect(out).toEqual({ scanned: 1, dispatched: 1, fired: 0 })
    expect(mockExecutionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'Temporal start_workflow failed: temporal down',
        }),
      }),
    )
    expect(mockDomainEventUpdateMany).toHaveBeenCalledTimes(1)
    expect(emittedMetrics()).toContainEqual(
      expect.objectContaining({
        MetricName: 'WorkflowTriggerSkipped',
        Dimensions: [{ Name: 'Reason', Value: 'START_FAILED' }],
      }),
    )
  })

  it('failure isolation: the first trigger throwing does not block the second or the stamp', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    mockTriggerFindMany.mockResolvedValue([
      triggerRow({ id: 'trg-bad' }),
      triggerRow({ id: 'trg-good' }),
    ])
    // First trigger's workflow lookup explodes; second resolves normally.
    mockWorkflowFindFirst
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockResolvedValueOnce(workflowRow())

    const out = await handler()

    expect(out).toEqual({ scanned: 1, dispatched: 1, fired: 1 })
    expect(mockExecutionCreate).toHaveBeenCalledTimes(1)
    expect(
      (mockExecutionCreate.mock.calls[0]![0] as { data: { triggeredByTriggerId: string } }).data
        .triggeredByTriggerId,
    ).toBe('trg-good')
    expect(mockDomainEventUpdateMany).toHaveBeenCalledTimes(1)
    expect(emittedMetrics()).toContainEqual(
      expect.objectContaining({
        MetricName: 'WorkflowTriggerSkipped',
        Dimensions: [{ Name: 'Reason', Value: 'ERROR' }],
      }),
    )
  })

  it('a failed trigger lookup leaves the event unstamped for the next tick', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    mockTriggerFindMany.mockRejectedValue(new Error('db down'))

    const out = await handler()

    expect(out).toEqual({ scanned: 1, dispatched: 0, fired: 0 })
    expect(mockDomainEventUpdateMany).not.toHaveBeenCalled()
  })

  it('one event failing does not abort the batch — the next event still dispatches', async () => {
    mockDomainEventFindMany.mockResolvedValue([
      eventRow({ id: 'evt-bad' }),
      eventRow({ id: 'evt-good' }),
    ])
    mockTriggerFindMany.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce([])

    const out = await handler()

    expect(out).toEqual({ scanned: 2, dispatched: 1, fired: 0 })
    expect(mockDomainEventUpdateMany).toHaveBeenCalledTimes(1)
    expect(
      (mockDomainEventUpdateMany.mock.calls[0]![0] as { where: { id: string } }).where.id,
    ).toBe('evt-good')
  })

  it('a full batch logs a backlog warning and emits the backlog metric', async () => {
    mockDomainEventFindMany.mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => eventRow({ id: `evt-${i}` })),
    )
    mockTriggerFindMany.mockResolvedValue([])

    const out = await handler()

    expect(out.scanned).toBe(100)
    expect(emittedMetrics()).toContainEqual(
      expect.objectContaining({ MetricName: 'DomainEventDispatchBacklog', Value: 1 }),
    )
  })

  it('a concurrent tick that already stamped the event is not double-counted', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    mockTriggerFindMany.mockResolvedValue([])
    mockDomainEventUpdateMany.mockResolvedValue({ count: 0 })

    const out = await handler()

    expect(out).toEqual({ scanned: 1, dispatched: 0, fired: 0 })
  })
})
