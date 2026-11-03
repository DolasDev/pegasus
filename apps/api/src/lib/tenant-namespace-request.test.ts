// ---------------------------------------------------------------------------
// requestTenantNamespace (legacy-runner retirement): the automatic Provision.
// The repository and the provisioner invoke are mocked.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

const { mockRepo, mockInvoke } = vi.hoisted(() => ({
  mockRepo: {
    findByTenant: vi.fn(),
    createProvisioning: vi.fn(),
    transition: vi.fn(),
    markFailed: vi.fn(),
  },
  mockInvoke: vi.fn(),
}))

vi.mock('../repositories/tenant-temporal-namespace.repository', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTenantTemporalNamespaceRepository: () => mockRepo,
}))
vi.mock('./temporal-provisioner-invoke', () => ({
  invokeTemporalProvisioner: mockInvoke,
  temporalProvisionerFunctionName: () => process.env['TEMPORAL_PROVISIONER_FUNCTION_NAME'] || null,
}))

import {
  requestTenantNamespace,
  requestTenantNamespaceQuietly,
  tenantNamespacesConfigured,
} from './tenant-namespace-request'

const db = {} as PrismaClient
const TENANT_ID = 'a90b22bc-4393-4ccc-8ddd-eeeeeeeeffff'
const NS = 'pg-staging-a90b22bc4393.chgel'
const NOW = new Date('2026-11-03T12:00:00.000Z')

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ttn_1',
    tenantId: TENANT_ID,
    namespace: NS,
    grpcAddress: `${NS}.tmprl.cloud:7233`,
    status: 'PROVISIONING',
    leaseExpiresAt: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const saved = { ...process.env }
beforeEach(() => {
  vi.resetAllMocks()
  process.env['TEMPORAL_PROVISIONER_FUNCTION_NAME'] = 'pegasus-staging-temporal-provisioner'
  process.env['TEMPORAL_NAMESPACE'] = 'pegasus-staging.chgel'
  process.env['TEMPORAL_TASK_QUEUE'] = 'pegasus-stdlib-staging'
  mockInvoke.mockResolvedValue(undefined)
})
afterEach(() => {
  process.env = { ...saved }
})

describe('requestTenantNamespace', () => {
  it('is NOT_CONFIGURED, touching nothing, where no provisioner is deployed', async () => {
    delete process.env['TEMPORAL_PROVISIONER_FUNCTION_NAME']
    expect(tenantNamespacesConfigured()).toBe(false)
    const result = await requestTenantNamespace(db, TENANT_ID, { cause: 'publish', now: NOW })
    expect(result.outcome).toBe('NOT_CONFIGURED')
    expect(mockRepo.findByTenant).not.toHaveBeenCalled()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('creates the PROVISIONING row for a tenant with none, then invokes provision', async () => {
    mockRepo.findByTenant.mockResolvedValue(null)
    mockRepo.createProvisioning.mockResolvedValue({ outcome: 'created', row: row() })
    const beforeInvoke = vi.fn()
    const result = await requestTenantNamespace(db, TENANT_ID, {
      cause: 'publish',
      now: NOW,
      beforeInvoke,
    })
    expect(result.outcome).toBe('REQUESTED')
    expect(mockRepo.createProvisioning).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      namespace: NS,
      grpcAddress: `${NS}.tmprl.cloud:7233`,
    })
    expect(beforeInvoke).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ status: 'PROVISIONING' }),
    )
    expect(mockInvoke).toHaveBeenCalledWith({ action: 'provision', tenantId: TENANT_ID })
  })

  it('leaves a concurrent request that won the insert to invoke', async () => {
    mockRepo.findByTenant.mockResolvedValue(null)
    mockRepo.createProvisioning.mockResolvedValue({ outcome: 'exists', row: row() })
    const result = await requestTenantNamespace(db, TENANT_ID, { cause: 'start', now: NOW })
    expect(result.outcome).toBe('IN_PROGRESS')
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it.each(['READY', 'DRAINING', 'ACTIVE', 'REVERTING'])(
    'does nothing on a %s row',
    async (status) => {
      mockRepo.findByTenant.mockResolvedValue(row({ status }))
      const result = await requestTenantNamespace(db, TENANT_ID, { cause: 'publish', now: NOW })
      expect(result.outcome).toBe('EXISTS')
      expect(mockInvoke).not.toHaveBeenCalled()
    },
  )

  it('refuses while deprovisioning', async () => {
    mockRepo.findByTenant.mockResolvedValue(row({ status: 'DEPROVISIONING' }))
    const result = await requestTenantNamespace(db, TENANT_ID, { cause: 'publish', now: NOW })
    expect(result.outcome).toBe('CONFLICT')
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('leaves a PROVISIONING row alone while its run holds the lease', async () => {
    mockRepo.findByTenant.mockResolvedValue(
      row({ leaseExpiresAt: new Date(NOW.getTime() + 60_000) }),
    )
    const result = await requestTenantNamespace(db, TENANT_ID, { cause: 'start', now: NOW })
    expect(result.outcome).toBe('IN_PROGRESS')
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('re-invokes a PROVISIONING row whose lease expired (a killed run)', async () => {
    mockRepo.findByTenant.mockResolvedValue(
      row({ leaseExpiresAt: new Date(NOW.getTime() - 60_000) }),
    )
    const result = await requestTenantNamespace(db, TENANT_ID, { cause: 'retry', now: NOW })
    expect(result.outcome).toBe('REQUESTED')
    expect(mockRepo.createProvisioning).not.toHaveBeenCalled()
    expect(mockInvoke).toHaveBeenCalledOnce()
  })

  it('resumes a FAILED row: FAILED → PROVISIONING, then invoke', async () => {
    mockRepo.findByTenant
      .mockResolvedValueOnce(row({ status: 'FAILED', lastError: 'boom' }))
      .mockResolvedValueOnce(row())
    mockRepo.transition.mockResolvedValue(true)
    const result = await requestTenantNamespace(db, TENANT_ID, { cause: 'retry', now: NOW })
    expect(mockRepo.transition).toHaveBeenCalledWith(TENANT_ID, ['FAILED'], 'PROVISIONING')
    expect(result.outcome).toBe('REQUESTED')
    expect(mockInvoke).toHaveBeenCalledOnce()
  })

  it('is a CONFLICT, without invoking, when a FAILED row moved under the compare-and-set', async () => {
    mockRepo.findByTenant.mockResolvedValue(row({ status: 'FAILED' }))
    mockRepo.transition.mockResolvedValue(false)
    const result = await requestTenantNamespace(db, TENANT_ID, { cause: 'retry', now: NOW })
    expect(result.outcome).toBe('CONFLICT')
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('marks the row FAILED and reports it when the invoke fails, never throwing', async () => {
    mockRepo.findByTenant.mockResolvedValue(null)
    mockRepo.createProvisioning.mockResolvedValue({ outcome: 'created', row: row() })
    mockInvoke.mockRejectedValue(new Error('AccessDeniedException'))
    const result = await requestTenantNamespace(db, TENANT_ID, { cause: 'start', now: NOW })
    expect(result).toMatchObject({ outcome: 'INVOKE_FAILED', message: 'AccessDeniedException' })
    expect(mockRepo.markFailed).toHaveBeenCalledWith(
      TENANT_ID,
      'invoke failed: AccessDeniedException',
    )
  })
})

describe('requestTenantNamespaceQuietly', () => {
  it('reports the status to show the author', async () => {
    mockRepo.findByTenant.mockResolvedValue(null)
    mockRepo.createProvisioning.mockResolvedValue({ outcome: 'created', row: row() })
    expect(await requestTenantNamespaceQuietly(db, TENANT_ID, 'publish')).toEqual({
      status: 'PROVISIONING',
      ready: false,
    })
  })

  it('reports ready for an ACTIVE tenant', async () => {
    mockRepo.findByTenant.mockResolvedValue(row({ status: 'ACTIVE' }))
    expect(await requestTenantNamespaceQuietly(db, TENANT_ID, 'fork')).toEqual({
      status: 'ACTIVE',
      ready: true,
    })
  })

  it('reports FAILED when the invoke fails', async () => {
    mockRepo.findByTenant.mockResolvedValue(null)
    mockRepo.createProvisioning.mockResolvedValue({ outcome: 'created', row: row() })
    mockInvoke.mockRejectedValue(new Error('throttled'))
    expect(await requestTenantNamespaceQuietly(db, TENANT_ID, 'publish')).toEqual({
      status: 'FAILED',
      ready: false,
    })
  })

  it('swallows a database error (publish must still succeed) and returns null', async () => {
    mockRepo.findByTenant.mockRejectedValue(new Error('connection reset'))
    expect(await requestTenantNamespaceQuietly(db, TENANT_ID, 'publish')).toBeNull()
  })

  it('returns null where namespaces are not provisioned', async () => {
    delete process.env['TEMPORAL_PROVISIONER_FUNCTION_NAME']
    expect(await requestTenantNamespaceQuietly(db, TENANT_ID, 'publish')).toBeNull()
  })
})
