// ---------------------------------------------------------------------------
// Unit tests for the workflow-trigger dispatcher poller (Phase 3 Units 3+4).
//
// Verifies the outbox-drain contract (Unit 3):
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
// And the schedule phase (Unit 4):
//   - a SCHEDULE trigger whose cron matches the tick's UTC fire-minute fires
//     with SCHEDULE provenance and the deterministic fire-minute id
//     `wf/<tenantId>/<name>/trg/<triggerId>/<compact-minute>` (20260610T1604Z)
//   - not-due triggers are silent (no execution, no skip metric)
//   - re-evaluating the same fire-minute is a DUPLICATE skip (no second row)
//   - an unparseable cron (pre-Unit-4 row) is an INVALID_CRON skip that never
//     poisons the tick; disabled rows are filtered at the query
//
// The shared run path (lib/start-workflow-execution.ts) runs for REAL against
// the mocked `../db`; Temporal is injected via _setTemporalClientForTesting
// so no gRPC connection is opened. The CloudWatch SDK is mocked.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  mockExecutionCount,
  mockTenantFindUnique,
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
  mockExecutionCount: vi.fn(),
  // Used by the kill-switch check in start-workflow-execution.ts.
  // Default: workflowsDisabled=false (kill switch off).
  mockTenantFindUnique: vi.fn(),
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
      count: mockExecutionCount,
    },
    // Kill-switch check in start-workflow-execution.ts.
    tenant: {
      findUnique: mockTenantFindUnique,
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

function scheduleTriggerRow(overrides: Record<string, unknown> = {}) {
  return triggerRow({
    id: 'trg-sched-1',
    kind: 'SCHEDULE',
    eventType: null,
    cronExpression: '4 16 * * *',
    ...overrides,
  })
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

/**
 * Kind-aware trigger query stub. The handler queries EVENT triggers once per
 * event AND the cross-tenant SCHEDULE set once per tick, both through the
 * same findMany — route on `where.kind` so each phase gets its own rows.
 */
function setTriggers(opts: { event?: unknown[]; schedule?: unknown[] }) {
  mockTriggerFindMany.mockImplementation((args: { where: { kind: string } }) =>
    Promise.resolve(args.where.kind === 'SCHEDULE' ? (opts.schedule ?? []) : (opts.event ?? [])),
  )
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
  // Default: 0 active/daily executions (below any limit)
  mockExecutionCount.mockResolvedValue(0)
  // Default: kill switch OFF (workflowsDisabled=false)
  mockTenantFindUnique.mockResolvedValue({ workflowsDisabled: false })
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

// ── Handler: domain-event phase ──────────────────────────────────────────

describe('lambda-dispatch-workflow-triggers', () => {
  it('queries undispatched events oldest-first, bounded at 100', async () => {
    await handler()

    expect(mockDomainEventFindMany).toHaveBeenCalledWith({
      where: { dispatchedAt: null },
      orderBy: { occurredAt: 'asc' },
      take: 100,
    })
  })

  it('an idle tick only sweeps SCHEDULE triggers and emits no metrics', async () => {
    const out = await handler()

    expect(out).toEqual({
      scanned: 0,
      dispatched: 0,
      fired: 0,
      schedulesEvaluated: 0,
      scheduleFired: 0,
      runnersLaunched: 0,
    })
    // No events ⇒ no per-event EVENT-trigger queries; the only trigger query
    // is the schedule sweep (Unit 4), which runs every tick.
    expect(mockTriggerFindMany).toHaveBeenCalledTimes(1)
    expect(mockTriggerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: 'SCHEDULE', enabled: true } }),
    )
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('fires a matching trigger: EVENT provenance, deterministic Temporal id, stamped event', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    setTriggers({ event: [triggerRow()] })

    const out = await handler()

    expect(out).toEqual({
      scanned: 1,
      dispatched: 1,
      fired: 1,
      schedulesEvaluated: 0,
      scheduleFired: 0,
      runnersLaunched: 0,
    })

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
    setTriggers({ event: [triggerRow()] })
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
    setTriggers({ event: [triggerRow({ filter: { quoteId: 'other' } })] })

    const out = await handler()

    expect(out).toEqual({
      scanned: 1,
      dispatched: 1,
      fired: 0,
      schedulesEvaluated: 0,
      scheduleFired: 0,
      runnersLaunched: 0,
    })
    expect(mockExecutionCreate).not.toHaveBeenCalled()
    expect(mockDomainEventUpdateMany).toHaveBeenCalledTimes(1)
  })

  it('filter match (shallow equality) fires the trigger', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    setTriggers({ event: [triggerRow({ filter: { quoteId: 'q-1' } })] })

    const out = await handler()

    expect(out.fired).toBe(1)
  })

  it('duplicate redelivery: an existing row with the deterministic id is skipped', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    setTriggers({ event: [triggerRow()] })
    mockExecutionFindFirst.mockResolvedValue({ id: 'exec-existing' })

    const out = await handler()

    expect(out).toEqual({
      scanned: 1,
      dispatched: 1,
      fired: 0,
      schedulesEvaluated: 0,
      scheduleFired: 0,
      runnersLaunched: 0,
    })
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
    setTriggers({ event: [triggerRow()] })
    mockWorkflowFindFirst.mockResolvedValue(workflowRow({ name: 'tenant_custom_workflow' }))

    const out = await handler()

    expect(out).toEqual({
      scanned: 1,
      dispatched: 1,
      fired: 0,
      schedulesEvaluated: 0,
      scheduleFired: 0,
      runnersLaunched: 0,
    })
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
    setTriggers({ event: [triggerRow()] })
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

    expect(out).toEqual({
      scanned: 1,
      dispatched: 1,
      fired: 0,
      schedulesEvaluated: 0,
      scheduleFired: 0,
      runnersLaunched: 0,
    })
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
    setTriggers({ event: [triggerRow()] })
    const start = vi.fn().mockRejectedValue(new Error('temporal down'))
    _setTemporalClientForTesting(fakeTemporalClient(start))
    mockExecutionUpdate.mockResolvedValue(queuedExecution({ status: 'FAILED', finishedAt: now }))

    const out = await handler()

    expect(out).toEqual({
      scanned: 1,
      dispatched: 1,
      fired: 0,
      schedulesEvaluated: 0,
      scheduleFired: 0,
      runnersLaunched: 0,
    })
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
    setTriggers({ event: [triggerRow({ id: 'trg-bad' }), triggerRow({ id: 'trg-good' })] })
    // First trigger's workflow lookup explodes; second resolves normally.
    mockWorkflowFindFirst
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockResolvedValueOnce(workflowRow())

    const out = await handler()

    expect(out).toEqual({
      scanned: 1,
      dispatched: 1,
      fired: 1,
      schedulesEvaluated: 0,
      scheduleFired: 0,
      runnersLaunched: 0,
    })
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
    // Every trigger query fails — including the schedule sweep, which is
    // isolated by its own catch (schedulesEvaluated stays 0).
    mockTriggerFindMany.mockRejectedValue(new Error('db down'))

    const out = await handler()

    expect(out).toEqual({
      scanned: 1,
      dispatched: 0,
      fired: 0,
      schedulesEvaluated: 0,
      scheduleFired: 0,
      runnersLaunched: 0,
    })
    expect(mockDomainEventUpdateMany).not.toHaveBeenCalled()
  })

  it('one event failing does not abort the batch — the next event still dispatches', async () => {
    mockDomainEventFindMany.mockResolvedValue([
      eventRow({ id: 'evt-bad' }),
      eventRow({ id: 'evt-good' }),
    ])
    mockTriggerFindMany.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce([])

    const out = await handler()

    expect(out).toEqual({
      scanned: 2,
      dispatched: 1,
      fired: 0,
      schedulesEvaluated: 0,
      scheduleFired: 0,
      runnersLaunched: 0,
    })
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

    expect(out).toEqual({
      scanned: 1,
      dispatched: 0,
      fired: 0,
      schedulesEvaluated: 0,
      scheduleFired: 0,
      runnersLaunched: 0,
    })
  })
})

// ── Handler: schedule phase (Phase 3 Unit 4) ─────────────────────────────

describe('scheduled triggers', () => {
  // The whole tick is pinned mid-minute: fire-minute = 2026-06-10T16:04 UTC.
  const tickNow = new Date('2026-06-10T16:04:23.456Z')
  const FIRE_MINUTE_ISO = '2026-06-10T16:04:00.000Z'
  const SCHEDULE_ID = 'wf/tenant-1/send_quote_followup/trg/trg-sched-1/20260610T1604Z'

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(tickNow)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('a due trigger fires with SCHEDULE provenance and the deterministic fire-minute id', async () => {
    setTriggers({ schedule: [scheduleTriggerRow()] }) // '4 16 * * *' — due
    const start = vi.fn().mockResolvedValue({
      workflowId: SCHEDULE_ID,
      firstExecutionRunId: 'run-1',
    })
    _setTemporalClientForTesting(fakeTemporalClient(start))

    const out = await handler()

    expect(out).toEqual({
      scanned: 0,
      dispatched: 0,
      fired: 0,
      schedulesEvaluated: 1,
      scheduleFired: 1,
      runnersLaunched: 0,
    })

    // Disabled rows never reach the loop — filtered at the query.
    expect(mockTriggerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: 'SCHEDULE', enabled: true } }),
    )

    // Execution row: SCHEDULE provenance + fire-minute deterministic id AT
    // CREATE, with the scheduledFor envelope as input.
    expect(mockExecutionCreate).toHaveBeenCalledTimes(1)
    const createArg = mockExecutionCreate.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(createArg.data).toMatchObject({
      tenantId: 'tenant-1',
      workflowId: 'wf-1',
      status: 'QUEUED',
      triggeredByUserId: null,
      triggerSource: 'SCHEDULE',
      triggeredByTriggerId: 'trg-sched-1',
      temporalWorkflowId: SCHEDULE_ID,
    })
    expect(createArg.data['input']).toEqual({
      scheduledFor: FIRE_MINUTE_ISO,
      triggerId: 'trg-sched-1',
    })

    expect(start).toHaveBeenCalledWith(
      'send_quote_followup',
      expect.objectContaining({
        workflowId: SCHEDULE_ID,
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
      }),
    )

    expect(emittedMetrics()).toContainEqual(
      expect.objectContaining({ MetricName: 'WorkflowTriggerFired', Value: 1 }),
    )
  })

  it('a not-due trigger does nothing — no execution, no skip metric, no log noise', async () => {
    setTriggers({ schedule: [scheduleTriggerRow({ cronExpression: '5 16 * * *' })] })

    const out = await handler()

    expect(out).toEqual({
      scanned: 0,
      dispatched: 0,
      fired: 0,
      schedulesEvaluated: 1,
      scheduleFired: 0,
      runnersLaunched: 0,
    })
    expect(mockExecutionCreate).not.toHaveBeenCalled()
    // Nothing fired, nothing skipped ⇒ nothing to flush.
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('re-evaluating the same fire-minute is a DUPLICATE skip — no second row', async () => {
    setTriggers({ schedule: [scheduleTriggerRow()] })
    mockExecutionFindFirst.mockResolvedValue({ id: 'exec-existing' })

    const out = await handler()

    expect(out).toEqual({
      scanned: 0,
      dispatched: 0,
      fired: 0,
      schedulesEvaluated: 1,
      scheduleFired: 0,
      runnersLaunched: 0,
    })
    expect(mockExecutionFindFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', temporalWorkflowId: SCHEDULE_ID },
      select: { id: true },
    })
    expect(mockExecutionCreate).not.toHaveBeenCalled()
    expect(emittedMetrics()).toContainEqual(
      expect.objectContaining({
        MetricName: 'WorkflowTriggerSkipped',
        Dimensions: [{ Name: 'Reason', Value: 'DUPLICATE' }],
      }),
    )
  })

  it('an unparseable cron (pre-Unit-4 row) is an INVALID_CRON skip and the tick continues', async () => {
    setTriggers({
      schedule: [
        scheduleTriggerRow({ id: 'trg-bad-cron', cronExpression: '61 * * * *' }),
        scheduleTriggerRow({ id: 'trg-good', cronExpression: '* * * * *' }),
      ],
    })

    const out = await handler()

    expect(out).toEqual({
      scanned: 0,
      dispatched: 0,
      fired: 0,
      schedulesEvaluated: 2,
      scheduleFired: 1,
      runnersLaunched: 0,
    })
    expect(mockExecutionCreate).toHaveBeenCalledTimes(1)
    expect(
      (mockExecutionCreate.mock.calls[0]![0] as { data: { triggeredByTriggerId: string } }).data
        .triggeredByTriggerId,
    ).toBe('trg-good')
    expect(emittedMetrics()).toContainEqual(
      expect.objectContaining({
        MetricName: 'WorkflowTriggerSkipped',
        Dimensions: [{ Name: 'Reason', Value: 'INVALID_CRON' }],
      }),
    )
  })

  it('a null cronExpression is an INVALID_CRON skip (defensive)', async () => {
    setTriggers({ schedule: [scheduleTriggerRow({ cronExpression: null })] })

    const out = await handler()

    expect(out.scheduleFired).toBe(0)
    expect(mockExecutionCreate).not.toHaveBeenCalled()
    expect(emittedMetrics()).toContainEqual(
      expect.objectContaining({
        MetricName: 'WorkflowTriggerSkipped',
        Dimensions: [{ Name: 'Reason', Value: 'INVALID_CRON' }],
      }),
    )
  })

  it('event and schedule fires share one tick and one WorkflowTriggerFired metric', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    setTriggers({
      event: [triggerRow()],
      schedule: [scheduleTriggerRow({ cronExpression: '* * * * *' })],
    })

    const out = await handler()

    expect(out).toEqual({
      scanned: 1,
      dispatched: 1,
      fired: 1,
      schedulesEvaluated: 1,
      scheduleFired: 1,
      runnersLaunched: 0,
    })
    expect(mockExecutionCreate).toHaveBeenCalledTimes(2)
    // One undimensioned counter for both kinds — kind detail is in logs and
    // the return value, not a metric dimension (see flushMetrics).
    expect(emittedMetrics()).toContainEqual(
      expect.objectContaining({ MetricName: 'WorkflowTriggerFired', Value: 2 }),
    )
  })
})

// ── Dispatcher: limit-rejection skip reasons (Phase 3 Unit 10) ────────────
//
// These tests verify that TENANT_RUNNER-lane limit rejections produce the
// right WorkflowTriggerSkipped{Reason=...} metrics and still stamp the
// domain event (no redelivery semantics — the tenant is over-capacity, not
// failing). Per the spec, the dispatcher treats limit outcomes the same as
// START_FAILED: logged skip, event stamped, tick continues.

describe('limit-rejection skip reasons (Unit 10)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('CONCURRENCY_LIMIT: trigger skipped, WorkflowTriggerSkipped{CONCURRENCY_LIMIT} emitted, event stamped', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    // Executable tenant workflow (routes TENANT_RUNNER).
    mockWorkflowFindFirst.mockResolvedValue(workflowRow({ name: 'my_custom_wf', executable: true }))
    setTriggers({ event: [triggerRow()] })
    // Concurrency cap hit (first count call = 5 active)
    mockExecutionCount.mockResolvedValueOnce(5)

    const out = await handler()

    expect(out.fired).toBe(0)
    expect(mockExecutionCreate).not.toHaveBeenCalled()
    // Event is still stamped — no redelivery.
    expect(mockDomainEventUpdateMany).toHaveBeenCalledTimes(1)
    expect(emittedMetrics()).toContainEqual(
      expect.objectContaining({
        MetricName: 'WorkflowTriggerSkipped',
        Dimensions: [{ Name: 'Reason', Value: 'CONCURRENCY_LIMIT' }],
      }),
    )
  })

  it('DAILY_QUOTA_EXCEEDED: trigger skipped, WorkflowTriggerSkipped{DAILY_QUOTA_EXCEEDED} emitted, event stamped', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    mockWorkflowFindFirst.mockResolvedValue(workflowRow({ name: 'my_custom_wf', executable: true }))
    setTriggers({ event: [triggerRow()] })
    // Concurrency: 0; daily quota: 200 (at quota)
    mockExecutionCount.mockResolvedValueOnce(0).mockResolvedValueOnce(200)

    const out = await handler()

    expect(out.fired).toBe(0)
    expect(mockExecutionCreate).not.toHaveBeenCalled()
    expect(mockDomainEventUpdateMany).toHaveBeenCalledTimes(1)
    expect(emittedMetrics()).toContainEqual(
      expect.objectContaining({
        MetricName: 'WorkflowTriggerSkipped',
        Dimensions: [{ Name: 'Reason', Value: 'DAILY_QUOTA_EXCEEDED' }],
      }),
    )
  })

  it('curated triggers are never limit-rejected (no count calls for curated workflow)', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    // Curated workflow (routes STDLIB) — limits are never checked.
    mockWorkflowFindFirst.mockResolvedValue(workflowRow({ name: 'send_quote_followup' }))
    setTriggers({ event: [triggerRow()] })
    // Even if count would return "over limit", the curated run is not checked.
    mockExecutionCount.mockResolvedValue(9999)

    const out = await handler()

    expect(out.fired).toBe(1)
    // count is never called for STDLIB-routed executions
    expect(mockExecutionCount).not.toHaveBeenCalled()
  })
})

// ── Dispatcher: kill-switch skip reason (Phase 3 Unit 11) ─────────────────
//
// When workflowsDisabled=true on the tenant row, the shared run path returns
// WORKFLOWS_DISABLED and the dispatcher should:
//   - emit WorkflowTriggerSkipped{Reason=WORKFLOWS_DISABLED}
//   - still stamp the domain event (no redelivery semantics)
//   - NOT create an execution row
//
// Curated (STDLIB-routed) triggers are also blocked by the kill switch — the
// check runs after route resolution for BOTH routes. RUNNING executions that
// started before the kill switch was set are unaffected.

describe('kill-switch (WORKFLOWS_DISABLED) skip reason (Unit 11)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('EVENT trigger skipped with WORKFLOWS_DISABLED metric when kill switch is on', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    mockWorkflowFindFirst.mockResolvedValue(workflowRow({ name: 'my_custom_wf', executable: true }))
    setTriggers({ event: [triggerRow()] })
    // Kill switch ON for tenant-1.
    mockTenantFindUnique.mockResolvedValue({ workflowsDisabled: true })

    const out = await handler()

    expect(out.fired).toBe(0)
    expect(mockExecutionCreate).not.toHaveBeenCalled()
    // Event is still stamped — operator kill switch is not a retriable error.
    expect(mockDomainEventUpdateMany).toHaveBeenCalledTimes(1)
    expect(emittedMetrics()).toContainEqual(
      expect.objectContaining({
        MetricName: 'WorkflowTriggerSkipped',
        Dimensions: [{ Name: 'Reason', Value: 'WORKFLOWS_DISABLED' }],
      }),
    )
  })

  it('curated (STDLIB) EVENT trigger is also blocked by the kill switch', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    // Curated workflow — but the kill switch still applies.
    mockWorkflowFindFirst.mockResolvedValue(workflowRow({ name: 'send_quote_followup' }))
    setTriggers({ event: [triggerRow()] })
    mockTenantFindUnique.mockResolvedValue({ workflowsDisabled: true })

    const out = await handler()

    expect(out.fired).toBe(0)
    expect(mockExecutionCreate).not.toHaveBeenCalled()
    expect(emittedMetrics()).toContainEqual(
      expect.objectContaining({
        MetricName: 'WorkflowTriggerSkipped',
        Dimensions: [{ Name: 'Reason', Value: 'WORKFLOWS_DISABLED' }],
      }),
    )
  })

  it('kill switch OFF: trigger fires normally (regression guard)', async () => {
    mockDomainEventFindMany.mockResolvedValue([eventRow()])
    mockWorkflowFindFirst.mockResolvedValue(workflowRow({ name: 'my_custom_wf', executable: true }))
    setTriggers({ event: [triggerRow()] })
    // Kill switch OFF (default — explicitly confirming the mock).
    mockTenantFindUnique.mockResolvedValue({ workflowsDisabled: false })

    const out = await handler()

    expect(out.fired).toBe(1)
    expect(mockExecutionCreate).toHaveBeenCalledTimes(1)
  })
})
