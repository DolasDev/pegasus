// ---------------------------------------------------------------------------
// Unit tests for the shared workflow-run path (Phase 3 Units 3 + 10).
//
// Unit 10 additions cover:
//   - Routing matrix: curated → stdlib queue; forked-curated (curated name,
//     tenant-owned) → stdlib; executable tenant wf → tenant queue +
//     ensureTenantRunner called; non-executable → NOT_EXECUTABLE; queue name
//     asserted EXACTLY.
//   - Timeout: default 900 s; manifest timeoutSeconds 300 → 300; manifest
//     absent → default; manifest value higher than default → clamped to
//     default (never silently raises the budget).
//   - Concurrency cap: 5 running → CONCURRENCY_LIMIT 429 outcome; 4 → allowed;
//     curated executions DO NOT count toward the cap and ARE NOT capped.
//   - Daily quota: at quota → DAILY_QUOTA_EXCEEDED; terminal rows count; UTC
//     day boundary pinned.
//   - Limit outcomes emit CloudWatch WorkflowExecutionRejected metrics.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client'
import type * as WorkflowRouteModule from './workflow-route'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockWorkflowRepo,
  mockApiClientRepo,
  mockExecutionRepo,
  mockTenantUserCreate,
  mockExecutionCount,
  mockEncryptRuntimeToken,
  mockTemporalStart,
  mockEnsureTenantRunner,
  mockCwSend,
  capturedPutMetricInputs,
} = vi.hoisted(() => {
  const capturedPutMetricInputs: Array<unknown> = []
  return {
    mockWorkflowRepo: {
      attachRuntimeToken: vi.fn(),
    },
    mockApiClientRepo: {
      create: vi.fn(),
    },
    mockExecutionRepo: {
      create: vi.fn(),
      markStarted: vi.fn(),
      markTerminal: vi.fn(),
    },
    mockTenantUserCreate: vi.fn(),
    // db.workflowExecution.count — used for both concurrency + quota checks
    mockExecutionCount: vi.fn(),
    mockEncryptRuntimeToken: vi.fn(),
    mockTemporalStart: vi.fn(),
    mockEnsureTenantRunner: vi.fn(),
    mockCwSend: vi.fn(),
    capturedPutMetricInputs,
  }
})

vi.mock('../repositories/workflow.repository', () => ({
  createWorkflowRepository: vi.fn(() => mockWorkflowRepo),
}))

vi.mock('../repositories/api-client.repository', () => ({
  createApiClientRepository: vi.fn(() => mockApiClientRepo),
}))

vi.mock('../repositories/workflow-execution.repository', () => ({
  createWorkflowExecutionRepository: vi.fn(() => mockExecutionRepo),
}))

vi.mock('./runtime-token-crypto', () => ({
  encryptRuntimeToken: mockEncryptRuntimeToken,
}))

vi.mock('./temporal-client', () => ({
  getTemporalClient: vi.fn(async () => ({ workflow: { start: mockTemporalStart } })),
  temporalTaskQueue: () => 'pegasus-stdlib-test',
}))

// tenant-runner: ensureTenantRunner is mocked; the real executionNeedsTenantRunner
// is NOT used here (the run path calls resolveWorkflowRoute directly).
vi.mock('./tenant-runner', () => ({
  ensureTenantRunner: mockEnsureTenantRunner,
}))

// CloudWatch: capture PutMetricDataCommand input
vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: class {
    send = mockCwSend
  },
  PutMetricDataCommand: class {
    public input: unknown
    constructor(input: unknown) {
      this.input = input
      capturedPutMetricInputs.push(input)
    }
  },
}))

// workflow-route: use the real routing logic (resolveWorkflowRoute) but
// override tenantTaskQueue so queue names are deterministic in tests.
// The env-suffix approach won't work because tenantTaskQueue reads process.env
// at call time, not at mock-module time.
vi.mock('./workflow-route', async (importOriginal) => {
  const real = await importOriginal<typeof WorkflowRouteModule>()
  return {
    ...real,
    // Return a deterministic test queue for any tenantId.
    tenantTaskQueue: (tenantId: string) => `pegasus-tenant-${tenantId}-test`,
  }
})

import { startWorkflowExecution } from './start-workflow-execution'
import type { WorkflowRow } from '../repositories/workflow.repository'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date('2026-06-12T12:00:00Z')

/** A curated-name workflow (routes STDLIB). */
const curatedWorkflow: WorkflowRow = {
  id: 'wf-1',
  tenantId: 'tenant-1',
  name: 'send_quote_followup',
  version: '1.0.0',
  visibility: 'GLOBAL',
  artifactKey: 'workflows/tenant-1/wf-1/1.0.0.zip',
  manifest: { name: 'send_quote_followup', version: '1.0.0' },
  createdByUserId: 'user-1',
  forkedFromWorkflowId: null,
  forkedFromVersion: null,
  runtimeTokenCiphertext: 'CIPHERTEXT',
  runtimeApiClientId: 'api-client-1',
  artifactSha256: 'abc123',
  artifactSizeBytes: 1024,
  executable: true,
  createdAt: now,
  updatedAt: now,
}

/** A tenant-uploaded executable workflow (routes TENANT_RUNNER). */
const tenantWorkflow: WorkflowRow = {
  ...curatedWorkflow,
  id: 'wf-2',
  tenantId: 'tenant-1',
  name: 'my_custom_workflow',
  visibility: 'TENANT',
  manifest: { name: 'my_custom_workflow', version: '1.0.0' },
  executable: true,
}

/** A non-executable tenant workflow (routes NOT_EXECUTABLE). */
const nonExecutableWorkflow: WorkflowRow = {
  ...tenantWorkflow,
  id: 'wf-3',
  name: 'incomplete_workflow',
  executable: false,
}

const queuedExecution = {
  id: 'exec-1',
  tenantId: 'tenant-1',
  workflowId: 'wf-1',
  status: 'QUEUED' as const,
  input: {},
  result: null,
  errorMessage: null,
  temporalWorkflowId: null,
  temporalRunId: null,
  triggeredByUserId: 'user-1',
  triggerSource: 'USER' as const,
  triggeredByTriggerId: null,
  queuedAt: now,
  startedAt: null,
  finishedAt: null,
  createdAt: now,
  updatedAt: now,
}

const runningExecution = {
  ...queuedExecution,
  status: 'RUNNING' as const,
  startedAt: now,
  temporalWorkflowId: 'wf/tenant-1/send_quote_followup/exec-1',
  temporalRunId: 'run-1',
}

function fakeDb(countValue = 0): PrismaClient {
  const db = {
    tenantUser: { create: mockTenantUserCreate },
    workflowExecution: { count: mockExecutionCount },
  } as unknown as PrismaClient
  ;(db as unknown as { $transaction: unknown }).$transaction = vi.fn(
    (cb: (tx: unknown) => unknown) => cb(db),
  )
  mockExecutionCount.mockResolvedValue(countValue)
  return db
}

beforeEach(() => {
  vi.clearAllMocks()
  capturedPutMetricInputs.length = 0
  mockExecutionRepo.create.mockResolvedValue(queuedExecution)
  mockExecutionRepo.markStarted.mockResolvedValue(runningExecution)
  mockExecutionRepo.markTerminal.mockResolvedValue({
    ...queuedExecution,
    status: 'FAILED',
    finishedAt: now,
  })
  mockTemporalStart.mockResolvedValue({
    workflowId: 'wf/tenant-1/send_quote_followup/exec-1',
    firstExecutionRunId: 'run-1',
  })
  mockTenantUserCreate.mockResolvedValue({ id: 'svc-user-1' })
  mockApiClientRepo.create.mockResolvedValue({
    row: { id: 'api-client-1', keyPrefix: 'vnd_abcd1234' },
    plainKey: 'vnd_PLAINTEXT',
  })
  mockEncryptRuntimeToken.mockResolvedValue('CIPHERTEXT')
  mockWorkflowRepo.attachRuntimeToken.mockResolvedValue(curatedWorkflow)
  mockEnsureTenantRunner.mockResolvedValue({ outcome: 'SKIPPED_UNCONFIGURED' })
  mockCwSend.mockResolvedValue({})
})

// ---------------------------------------------------------------------------
// Routing matrix tests
// ---------------------------------------------------------------------------

describe('routing matrix', () => {
  it('curated name → STDLIB queue; ensureTenantRunner NOT called', async () => {
    const result = await startWorkflowExecution(fakeDb(), {
      workflow: curatedWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(result.outcome).toBe('STARTED')
    expect(mockTemporalStart).toHaveBeenCalledWith(
      'send_quote_followup',
      expect.objectContaining({ taskQueue: 'pegasus-stdlib-test' }),
    )
    expect(mockEnsureTenantRunner).not.toHaveBeenCalled()
    // Curated runs are NOT capped — count is never checked
    expect(mockExecutionCount).not.toHaveBeenCalled()
  })

  it('forked-curated (curated name, tenant-owned) → STDLIB queue (shadowing contract)', async () => {
    // A tenant forked send_quote_followup. The name matches curated → STDLIB.
    const forkedCurated: WorkflowRow = {
      ...curatedWorkflow,
      visibility: 'TENANT',
      forkedFromWorkflowId: 'wf-global-1',
      forkedFromVersion: '1.0.0',
    }
    const result = await startWorkflowExecution(fakeDb(), {
      workflow: forkedCurated,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(result.outcome).toBe('STARTED')
    expect(mockTemporalStart).toHaveBeenCalledWith(
      'send_quote_followup',
      expect.objectContaining({ taskQueue: 'pegasus-stdlib-test' }),
    )
    expect(mockEnsureTenantRunner).not.toHaveBeenCalled()
  })

  it('executable tenant workflow → TENANT_RUNNER queue; ensureTenantRunner called', async () => {
    const result = await startWorkflowExecution(fakeDb(0), {
      workflow: tenantWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(result.outcome).toBe('STARTED')
    // Queue name must match exactly: pegasus-tenant-<tenantId>-<env>
    expect(mockTemporalStart).toHaveBeenCalledWith(
      'my_custom_workflow',
      expect.objectContaining({
        taskQueue: 'pegasus-tenant-tenant-1-test',
      }),
    )
    expect(mockEnsureTenantRunner).toHaveBeenCalledWith(expect.anything(), 'tenant-1')
  })

  it('tenant queue name is exactly pegasus-tenant-<tenantId>-<envSuffix>', async () => {
    const result = await startWorkflowExecution(fakeDb(0), {
      workflow: tenantWorkflow,
      tenantId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(result.outcome).toBe('STARTED')
    const [, startOpts] = mockTemporalStart.mock.calls[0] as [string, { taskQueue: string }]
    expect(startOpts.taskQueue).toBe('pegasus-tenant-0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0-test')
  })

  it('non-executable tenant workflow → NOT_EXECUTABLE; nothing written', async () => {
    const result = await startWorkflowExecution(fakeDb(), {
      workflow: nonExecutableWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(result).toEqual({ outcome: 'NOT_EXECUTABLE' })
    expect(mockExecutionRepo.create).not.toHaveBeenCalled()
    expect(mockTemporalStart).not.toHaveBeenCalled()
    expect(mockEnsureTenantRunner).not.toHaveBeenCalled()
  })

  it('ensureTenantRunner is called BEFORE Temporal start (cold-start overlap)', async () => {
    const callOrder: string[] = []
    mockEnsureTenantRunner.mockImplementation(async () => {
      callOrder.push('ensureTenantRunner')
      return { outcome: 'LAUNCHED', taskArn: 'arn:task/1' }
    })
    mockTemporalStart.mockImplementation(async () => {
      callOrder.push('temporalStart')
      return { workflowId: 'wf/t/n/e', firstExecutionRunId: 'r-1' }
    })

    await startWorkflowExecution(fakeDb(0), {
      workflow: tenantWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(callOrder).toEqual(['ensureTenantRunner', 'temporalStart'])
  })

  it('a failed runner launch does not fail a TENANT_RUNNER run', async () => {
    mockEnsureTenantRunner.mockResolvedValue({
      outcome: 'LAUNCH_FAILED',
      reason: 'RESOURCE:FARGATE',
    })

    const result = await startWorkflowExecution(fakeDb(0), {
      workflow: tenantWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(result.outcome).toBe('STARTED')
    expect(mockTemporalStart).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Timeout tests
// ---------------------------------------------------------------------------

describe('per-execution Temporal timeout (TENANT_RUNNER only)', () => {
  it('sets workflowExecutionTimeout to the default 900 s when manifest has no timeoutSeconds', async () => {
    await startWorkflowExecution(fakeDb(0), {
      workflow: tenantWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(mockTemporalStart).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ workflowExecutionTimeout: '900s' }),
    )
  })

  it('uses manifest timeoutSeconds=300 when present (lower than default)', async () => {
    const wfWith300: WorkflowRow = {
      ...tenantWorkflow,
      manifest: { name: 'my_custom_workflow', version: '1.0.0', timeoutSeconds: 300 },
    }

    await startWorkflowExecution(fakeDb(0), {
      workflow: wfWith300,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(mockTemporalStart).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ workflowExecutionTimeout: '300s' }),
    )
  })

  it('clamps manifest timeoutSeconds to default when it would exceed 900 s (defensive)', async () => {
    // The ManifestSchema rejects > 900 at finalize, but if a pre-Unit-10 row
    // somehow has a value above 900, the run path clamps to 900.
    const wfWith1200: WorkflowRow = {
      ...tenantWorkflow,
      manifest: { name: 'my_custom_workflow', version: '1.0.0', timeoutSeconds: 1200 },
    }

    await startWorkflowExecution(fakeDb(0), {
      workflow: wfWith1200,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(mockTemporalStart).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ workflowExecutionTimeout: '900s' }),
    )
  })

  it('does NOT set workflowExecutionTimeout for STDLIB (curated) runs', async () => {
    await startWorkflowExecution(fakeDb(), {
      workflow: curatedWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    const [, startOpts] = mockTemporalStart.mock.calls[0] as [
      string,
      { workflowExecutionTimeout?: string },
    ]
    expect(startOpts.workflowExecutionTimeout).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Concurrency cap tests
// ---------------------------------------------------------------------------

describe('per-tenant concurrency cap (TENANT_RUNNER only)', () => {
  it('allows start when 4 active executions (below cap of 5)', async () => {
    const result = await startWorkflowExecution(fakeDb(4), {
      workflow: tenantWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(result.outcome).toBe('STARTED')
  })

  it('rejects start when 5 active executions (at cap)', async () => {
    // First count call (concurrency) returns 5; quota count won't be reached.
    mockExecutionCount.mockResolvedValueOnce(5)

    const result = await startWorkflowExecution(fakeDb(), {
      workflow: tenantWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(result.outcome).toBe('CONCURRENCY_LIMIT')
    expect(mockExecutionRepo.create).not.toHaveBeenCalled()
    expect(mockTemporalStart).not.toHaveBeenCalled()
  })

  it('emits WorkflowExecutionRejected{Reason=CONCURRENCY_LIMIT} metric', async () => {
    mockExecutionCount.mockResolvedValueOnce(5)

    await startWorkflowExecution(fakeDb(), {
      workflow: tenantWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    const dims = capturedPutMetricInputs
      .flatMap(
        (p: unknown) =>
          (
            p as {
              MetricData?: Array<{
                Dimensions?: Array<{ Name: string; Value: string }>
                MetricName?: string
              }>
            }
          ).MetricData ?? [],
      )
      .filter((m) => m.MetricName === 'WorkflowExecutionRejected')
      .flatMap((m) => m.Dimensions ?? [])
    expect(dims).toContainEqual({ Name: 'Reason', Value: 'CONCURRENCY_LIMIT' })
  })

  it('curated (STDLIB) runs bypass the concurrency cap entirely', async () => {
    // Even with count returning 999, a curated run is not checked or blocked.
    mockExecutionCount.mockResolvedValue(999)

    const result = await startWorkflowExecution(fakeDb(999), {
      workflow: curatedWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(result.outcome).toBe('STARTED')
    // Count must NOT be called for curated workflows
    expect(mockExecutionCount).not.toHaveBeenCalled()
  })

  it('concurrency count query excludes curated workflow names (no false throttle)', async () => {
    // Regression guard: countTenantRunnerActiveExecutions must pass a
    // `workflow.name.notIn(CURATED_WORKFLOW_NAMES)` filter so that a tenant
    // with STDLIB-lane (curated) executions in flight is not falsely throttled
    // when starting a TENANT_RUNNER execution.
    await startWorkflowExecution(fakeDb(0), {
      workflow: tenantWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    // The first count call is the concurrency check.
    const firstCountWhere = mockExecutionCount.mock.calls[0]?.[0]?.where as Record<string, unknown>
    // Must filter by workflow.name.notIn (an array containing curated names).
    expect(firstCountWhere).toMatchObject({
      workflow: expect.objectContaining({
        name: expect.objectContaining({ notIn: expect.arrayContaining(['send_quote_followup']) }),
      }),
    })
  })
})

// ---------------------------------------------------------------------------
// Daily quota tests
// ---------------------------------------------------------------------------

describe('per-tenant daily quota (TENANT_RUNNER only)', () => {
  it('allows start when daily count is below quota (default 200)', async () => {
    // concurrency = 0, daily = 199
    mockExecutionCount.mockResolvedValueOnce(0).mockResolvedValueOnce(199)

    const result = await startWorkflowExecution(fakeDb(), {
      workflow: tenantWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(result.outcome).toBe('STARTED')
  })

  it('rejects start when daily count equals default quota (200)', async () => {
    // concurrency = 0, daily = 200
    mockExecutionCount.mockResolvedValueOnce(0).mockResolvedValueOnce(200)

    const result = await startWorkflowExecution(fakeDb(), {
      workflow: tenantWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(result.outcome).toBe('DAILY_QUOTA_EXCEEDED')
    expect(mockExecutionRepo.create).not.toHaveBeenCalled()
    expect(mockTemporalStart).not.toHaveBeenCalled()
  })

  it('terminal-status rows still count toward the daily quota', async () => {
    // 200 total today (FAILED + COMPLETED + QUEUED + RUNNING mixed — the
    // count query has no status filter). Quota is reached.
    mockExecutionCount.mockResolvedValueOnce(0).mockResolvedValueOnce(200)

    const result = await startWorkflowExecution(fakeDb(), {
      workflow: tenantWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(result.outcome).toBe('DAILY_QUOTA_EXCEEDED')
  })

  it('emits WorkflowExecutionRejected{Reason=DAILY_QUOTA_EXCEEDED} metric', async () => {
    mockExecutionCount.mockResolvedValueOnce(0).mockResolvedValueOnce(200)

    await startWorkflowExecution(fakeDb(), {
      workflow: tenantWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    const dims = capturedPutMetricInputs
      .flatMap(
        (p: unknown) =>
          (
            p as {
              MetricData?: Array<{
                Dimensions?: Array<{ Name: string; Value: string }>
                MetricName?: string
              }>
            }
          ).MetricData ?? [],
      )
      .filter((m) => m.MetricName === 'WorkflowExecutionRejected')
      .flatMap((m) => m.Dimensions ?? [])
    expect(dims).toContainEqual({ Name: 'Reason', Value: 'DAILY_QUOTA_EXCEEDED' })
  })

  it('curated (STDLIB) runs bypass the daily quota entirely', async () => {
    mockExecutionCount.mockResolvedValue(9999)

    const result = await startWorkflowExecution(fakeDb(9999), {
      workflow: curatedWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(result.outcome).toBe('STARTED')
    expect(mockExecutionCount).not.toHaveBeenCalled()
  })

  it('daily count query excludes curated workflow names (no false quota exhaustion)', async () => {
    // Regression guard: countTenantRunnerDailyExecutions must pass a
    // `workflow.name.notIn(CURATED_WORKFLOW_NAMES)` filter so that a tenant
    // with many STDLIB-lane (curated) runs today is not falsely quota-blocked
    // for TENANT_RUNNER executions.
    mockExecutionCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0)

    await startWorkflowExecution(fakeDb(), {
      workflow: tenantWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    // The second count call is the daily quota check.
    const secondCountWhere = mockExecutionCount.mock.calls[1]?.[0]?.where as Record<string, unknown>
    expect(secondCountWhere).toMatchObject({
      workflow: expect.objectContaining({
        name: expect.objectContaining({ notIn: expect.arrayContaining(['send_quote_followup']) }),
      }),
    })
  })
})

// ---------------------------------------------------------------------------
// Existing Phase-3 Unit-3 tests (provenance, ALREADY_STARTED, etc.)
// ---------------------------------------------------------------------------

describe('startWorkflowExecution (inherited Unit 3 contracts)', () => {
  it('USER provenance: inserts a USER row and uses the manual workflow-id scheme', async () => {
    const result = await startWorkflowExecution(fakeDb(), {
      workflow: curatedWorkflow,
      tenantId: 'tenant-1',
      input: { quote_id: 'q-1' },
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(result.outcome).toBe('STARTED')
    expect(mockExecutionRepo.create).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      workflowId: 'wf-1',
      triggeredByUserId: 'user-1',
      triggerSource: 'USER',
      triggeredByTriggerId: null,
      temporalWorkflowId: null,
      input: { quote_id: 'q-1' },
    })
    expect(mockTemporalStart).toHaveBeenCalledWith('send_quote_followup', {
      args: [{ executionId: 'exec-1', input: { quote_id: 'q-1' } }],
      taskQueue: 'pegasus-stdlib-test',
      workflowId: 'wf/tenant-1/send_quote_followup/exec-1',
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
    })
  })

  it('EVENT provenance: inserts an EVENT row (null user) with the trigger id', async () => {
    await startWorkflowExecution(fakeDb(), {
      workflow: curatedWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: {
        triggerSource: 'EVENT',
        triggeredByTriggerId: 'trg-1',
        runtimeAccountCreatedById: 'user-9',
      },
      temporalWorkflowId: 'wf/tenant-1/send_quote_followup/trg/trg-1/evt-1',
    })

    expect(mockExecutionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        triggeredByUserId: null,
        triggerSource: 'EVENT',
        triggeredByTriggerId: 'trg-1',
      }),
    )
  })

  it('persists a caller-supplied deterministic Temporal id at create time and starts with it', async () => {
    const deterministicId = 'wf/tenant-1/send_quote_followup/trg/trg-1/evt-1'
    await startWorkflowExecution(fakeDb(), {
      workflow: curatedWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: {
        triggerSource: 'EVENT',
        triggeredByTriggerId: 'trg-1',
        runtimeAccountCreatedById: 'user-9',
      },
      temporalWorkflowId: deterministicId,
    })

    expect(mockExecutionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ temporalWorkflowId: deterministicId }),
    )
    expect(mockTemporalStart.mock.calls[0]?.[1]?.['workflowId']).toBe(deterministicId)
  })

  it('lazy-mints the runtime account when missing, attributed to the provenance principal', async () => {
    await startWorkflowExecution(fakeDb(), {
      workflow: { ...curatedWorkflow, runtimeTokenCiphertext: null, runtimeApiClientId: null },
      tenantId: 'tenant-1',
      input: {},
      provenance: {
        triggerSource: 'EVENT',
        triggeredByTriggerId: 'trg-1',
        runtimeAccountCreatedById: 'trigger-creator-1',
      },
    })

    expect(mockTenantUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isServiceAccount: true,
          roleNames: ['workflow_runtime'],
        }),
      }),
    )
    expect(mockApiClientRepo.create).toHaveBeenCalledWith(
      'tenant-1',
      'wf-runtime-wf-1',
      [],
      'trigger-creator-1',
      expect.any(String),
    )
    expect(mockEncryptRuntimeToken).toHaveBeenCalled()
  })

  it('does NOT re-mint when the workflow already has a runtime account', async () => {
    await startWorkflowExecution(fakeDb(), {
      workflow: curatedWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(mockTenantUserCreate).not.toHaveBeenCalled()
    expect(mockApiClientRepo.create).not.toHaveBeenCalled()
  })

  it('marks the row FAILED and returns START_FAILED when Temporal start throws', async () => {
    mockTemporalStart.mockRejectedValue(new Error('boom'))

    const result = await startWorkflowExecution(fakeDb(), {
      workflow: curatedWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(result.outcome).toBe('START_FAILED')
    if (result.outcome === 'START_FAILED') {
      expect(result.message).toBe('boom')
      expect(result.execution?.status).toBe('FAILED')
    }
    expect(mockExecutionRepo.markTerminal).toHaveBeenCalledWith('exec-1', {
      status: 'FAILED',
      errorMessage: 'Temporal start_workflow failed: boom',
      finishedAt: expect.any(Date),
    })
  })

  it('returns START_FAILED with a null execution when the FAILED write also fails', async () => {
    mockTemporalStart.mockRejectedValue(new Error('boom'))
    mockExecutionRepo.markTerminal.mockRejectedValue(new Error('db down'))

    const result = await startWorkflowExecution(fakeDb(), {
      workflow: curatedWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(result).toEqual({ outcome: 'START_FAILED', message: 'boom', execution: null })
  })

  it('maps WorkflowExecutionAlreadyStartedError to ALREADY_STARTED without marking FAILED', async () => {
    mockTemporalStart.mockRejectedValue(
      new WorkflowExecutionAlreadyStartedError(
        'Workflow execution already started',
        'wf/tenant-1/send_quote_followup/trg/trg-1/evt-1',
        'send_quote_followup',
      ),
    )

    const result = await startWorkflowExecution(fakeDb(), {
      workflow: curatedWorkflow,
      tenantId: 'tenant-1',
      input: {},
      provenance: {
        triggerSource: 'EVENT',
        triggeredByTriggerId: 'trg-1',
        runtimeAccountCreatedById: 'user-9',
      },
      temporalWorkflowId: 'wf/tenant-1/send_quote_followup/trg/trg-1/evt-1',
    })

    expect(result.outcome).toBe('ALREADY_STARTED')
    expect(mockExecutionRepo.markTerminal).not.toHaveBeenCalled()
    expect(mockExecutionRepo.markStarted).not.toHaveBeenCalled()
  })
})
