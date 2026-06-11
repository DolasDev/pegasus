// ---------------------------------------------------------------------------
// Unit tests for the shared workflow-run path (Phase 3 Unit 3).
//
// Covers what the HTTP-handler tests (handlers/workflows.test.ts) can't see
// from the wire: provenance variants on the execution insert, caller-supplied
// deterministic Temporal ids persisted at create time, and the
// ALREADY_STARTED success-already-handled mapping. The repositories, KMS
// crypto, and the Temporal client module are mocked — same approach as the
// handler tests.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client'

const {
  mockWorkflowRepo,
  mockApiClientRepo,
  mockExecutionRepo,
  mockTenantUserCreate,
  mockEncryptRuntimeToken,
  mockTemporalStart,
} = vi.hoisted(() => ({
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
  mockEncryptRuntimeToken: vi.fn(),
  mockTemporalStart: vi.fn(),
}))

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

import { startWorkflowExecution } from './start-workflow-execution'
import type { WorkflowRow } from '../repositories/workflow.repository'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date('2026-06-10T12:00:00Z')

const workflow: WorkflowRow = {
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
  artifactSha256: null,
  artifactSizeBytes: null,
  executable: false,
  createdAt: now,
  updatedAt: now,
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

function fakeDb(): PrismaClient {
  const db = {
    tenantUser: { create: mockTenantUserCreate },
  } as unknown as PrismaClient
  // `$transaction` runs the callback with `tx === db` itself so the repo
  // mocks resolve regardless of the transaction wrapping.
  ;(db as unknown as { $transaction: unknown }).$transaction = vi.fn(
    (cb: (tx: unknown) => unknown) => cb(db),
  )
  return db
}

beforeEach(() => {
  vi.clearAllMocks()
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
  mockWorkflowRepo.attachRuntimeToken.mockResolvedValue(workflow)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startWorkflowExecution', () => {
  it('returns NOT_EXECUTABLE for non-curated names without writing anything', async () => {
    const result = await startWorkflowExecution(fakeDb(), {
      workflow: { ...workflow, name: 'tenant_custom_workflow' },
      tenantId: 'tenant-1',
      input: {},
      provenance: { triggerSource: 'USER', triggeredByUserId: 'user-1' },
    })

    expect(result).toEqual({ outcome: 'NOT_EXECUTABLE' })
    expect(mockExecutionRepo.create).not.toHaveBeenCalled()
    expect(mockTemporalStart).not.toHaveBeenCalled()
  })

  it('USER provenance: inserts a USER row and uses the manual workflow-id scheme', async () => {
    const result = await startWorkflowExecution(fakeDb(), {
      workflow,
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
      // Manual runs only record the Temporal id at markStarted.
      temporalWorkflowId: null,
      input: { quote_id: 'q-1' },
    })
    expect(mockTemporalStart).toHaveBeenCalledWith('send_quote_followup', {
      args: [{ executionId: 'exec-1', input: { quote_id: 'q-1' } }],
      taskQueue: 'pegasus-stdlib-test',
      workflowId: 'wf/tenant-1/send_quote_followup/exec-1',
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
    })
    expect(mockExecutionRepo.markStarted).toHaveBeenCalledWith('exec-1', {
      temporalWorkflowId: 'wf/tenant-1/send_quote_followup/exec-1',
      temporalRunId: 'run-1',
      startedAt: expect.any(Date),
    })
  })

  it('EVENT provenance: inserts an EVENT row (null user) with the trigger id', async () => {
    await startWorkflowExecution(fakeDb(), {
      workflow,
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
      workflow,
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
      workflow: { ...workflow, runtimeTokenCiphertext: null, runtimeApiClientId: null },
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
    // createdById = the trigger's creator (no user fired this run).
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
      workflow,
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
      workflow,
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
      workflow,
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
      workflow,
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
