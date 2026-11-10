// Unit tests for signalDurableExecution / declaredSignals. Temporal and the
// tenant runner are mocked (same seams as start-workflow-execution.test.ts).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { WorkflowExecutionRow } from '../repositories/workflow-execution.repository'

const { mockSignal, mockGetHandle, mockWithTemporalClient, mockEnsureTenantRunner } = vi.hoisted(
  () => {
    const mockSignal = vi.fn()
    const mockGetHandle = vi.fn(() => ({ signal: mockSignal }))
    const mockWithTemporalClient = vi.fn(
      async (_target: unknown, fn: (client: unknown) => Promise<unknown>) =>
        fn({ workflow: { getHandle: mockGetHandle } }),
    )
    return {
      mockSignal,
      mockGetHandle,
      mockWithTemporalClient,
      mockEnsureTenantRunner: vi.fn(),
    }
  },
)

vi.mock('./temporal-client', () => ({ withTemporalClient: mockWithTemporalClient }))
vi.mock('./tenant-runner', () => ({ ensureTenantRunner: mockEnsureTenantRunner }))

import { declaredSignals, signalDurableExecution } from './signal-workflow-execution'

const db = {} as PrismaClient
const now = new Date('2026-11-10T12:00:00Z')

const durableWorkflow = { name: 'order_lifecycle', executable: true, kind: 'WORKFLOW' as const }

const runningExecution: WorkflowExecutionRow = {
  id: 'exec-1',
  tenantId: 'tenant-1',
  workflowId: 'wf-1',
  status: 'RUNNING',
  input: {},
  result: null,
  errorMessage: null,
  temporalWorkflowId: 'wf/tenant-1/order_lifecycle/exec-1',
  temporalRunId: 'run-1',
  temporalNamespace: 'pegasus-t-tenant-1.acct',
  triggeredByUserId: 'user-1',
  triggerSource: 'USER',
  triggeredByTriggerId: null,
  dryRun: false,
  queuedAt: now,
  startedAt: now,
  finishedAt: null,
  createdAt: now,
  updatedAt: now,
} as WorkflowExecutionRow

function signal(overrides: { execution?: Partial<WorkflowExecutionRow>; workflow?: object } = {}) {
  return signalDurableExecution(db, {
    workflow: { ...durableWorkflow, ...overrides.workflow },
    execution: { ...runningExecution, ...overrides.execution },
    signalName: 'proceed',
    args: [{ ok: true }],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSignal.mockResolvedValue(undefined)
  mockEnsureTenantRunner.mockResolvedValue({ outcome: 'ALREADY_RUNNING', taskArns: [] })
})

describe('signalDurableExecution', () => {
  it('signals by workflow id on the row namespace, chained to the first run id', async () => {
    await expect(signal()).resolves.toEqual({ outcome: 'SIGNALLED' })

    expect(mockWithTemporalClient).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', namespace: 'pegasus-t-tenant-1.acct' },
      expect.any(Function),
    )
    expect(mockGetHandle).toHaveBeenCalledWith('wf/tenant-1/order_lifecycle/exec-1', undefined, {
      firstExecutionRunId: 'run-1',
    })
    expect(mockSignal).toHaveBeenCalledWith('proceed', { ok: true })
    expect(mockEnsureTenantRunner).toHaveBeenCalledWith(db, 'tenant-1')
  })

  it('passes no args when none are given', async () => {
    await signalDurableExecution(db, {
      workflow: durableWorkflow,
      execution: runningExecution,
      signalName: 'proceed',
      args: [],
    })
    expect(mockSignal).toHaveBeenCalledWith('proceed')
  })

  it('omits firstExecutionRunId while the row has no run id yet (QUEUED)', async () => {
    await signal({ execution: { status: 'QUEUED', temporalRunId: null } })
    expect(mockGetHandle).toHaveBeenCalledWith('wf/tenant-1/order_lifecycle/exec-1', undefined, {})
  })

  it('refuses an Automation row', async () => {
    await expect(signal({ workflow: { kind: 'AUTOMATION' } })).resolves.toEqual({
      outcome: 'NOT_DURABLE',
    })
    expect(mockWithTemporalClient).not.toHaveBeenCalled()
  })

  it('refuses a non-executable (non tenant-runner) row', async () => {
    await expect(signal({ workflow: { executable: false } })).resolves.toEqual({
      outcome: 'NOT_DURABLE',
    })
  })

  it.each(['COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELLED'] as const)(
    'refuses a %s row',
    async (status) => {
      await expect(signal({ execution: { status } })).resolves.toEqual({ outcome: 'TERMINAL' })
      expect(mockWithTemporalClient).not.toHaveBeenCalled()
    },
  )

  it('refuses a row with no Temporal workflow id', async () => {
    await expect(
      signal({ execution: { status: 'QUEUED', temporalWorkflowId: null } }),
    ).resolves.toEqual({ outcome: 'NOT_STARTED' })
    expect(mockWithTemporalClient).not.toHaveBeenCalled()
  })

  it('maps WorkflowNotFoundError to NOT_RUNNING without ensuring a runner', async () => {
    const notFound = new Error('workflow execution already completed')
    notFound.name = 'WorkflowNotFoundError'
    mockSignal.mockRejectedValueOnce(notFound)

    await expect(signal()).resolves.toEqual({ outcome: 'NOT_RUNNING' })
    expect(mockEnsureTenantRunner).not.toHaveBeenCalled()
  })

  it('maps any other Temporal error to SIGNAL_FAILED', async () => {
    mockSignal.mockRejectedValueOnce(new Error('connection reset'))
    await expect(signal()).resolves.toEqual({
      outcome: 'SIGNAL_FAILED',
      message: 'connection reset',
    })
  })

  it('still reports SIGNALLED when ensuring the runner throws', async () => {
    mockEnsureTenantRunner.mockRejectedValueOnce(new Error('db down'))
    await expect(signal()).resolves.toEqual({ outcome: 'SIGNALLED' })
  })
})

describe('declaredSignals', () => {
  it('reads the manifest signals list', () => {
    expect(declaredSignals({ signals: ['proceed', 'note'] })).toEqual(['proceed', 'note'])
  })

  it('is empty for a manifest without signals, or a non-object', () => {
    expect(declaredSignals({ name: 'x' })).toEqual([])
    expect(declaredSignals(null)).toEqual([])
    expect(declaredSignals('x')).toEqual([])
  })
})
