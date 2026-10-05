// ---------------------------------------------------------------------------
// Unit tests for the admin Temporal-namespace handler (Phase 3b).
//
// db, the repository, audit and the provisioner invoke are mocked.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { AdminEnv } from '../../types'

const { mockDb, mockRepo, mockInvoke, mockAudit } = vi.hoisted(() => ({
  mockDb: {
    tenant: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  mockRepo: {
    findByTenant: vi.fn(),
    createProvisioning: vi.fn(),
    transition: vi.fn(),
    markFailed: vi.fn(),
  },
  mockInvoke: vi.fn(),
  mockAudit: vi.fn(),
}))

vi.mock('../../db', () => ({ db: mockDb }))
vi.mock('./audit', () => ({ writeAuditLog: mockAudit }))
vi.mock('../../repositories/tenant-temporal-namespace.repository', () => ({
  createTenantTemporalNamespaceRepository: () => mockRepo,
}))
vi.mock('../../lib/temporal-provisioner-invoke', () => ({
  invokeTemporalProvisioner: mockInvoke,
  temporalProvisionerFunctionName: () => process.env['TEMPORAL_PROVISIONER_FUNCTION_NAME'] || null,
}))

import { adminTemporalNamespaceRouter } from './temporal-namespace'

const TENANT_ID = 'a90b22bc-4393-4ccc-8ddd-eeeeeeeeffff'
const NS = 'pg-staging-a90b22bc4393.chgel'
const NOW = new Date('2026-10-05T12:00:00.000Z')

function buildApp() {
  const app = new Hono<AdminEnv>()
  app.use('*', async (c, next) => {
    c.set('adminSub', 'admin-sub-123')
    c.set('adminEmail', 'admin@platform.com')
    await next()
  })
  app.route('/tenants/:tenantId/temporal-namespace', adminTemporalNamespaceRouter)
  return app
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ttn_1',
    tenantId: TENANT_ID,
    namespace: NS,
    grpcAddress: `${NS}.tmprl.cloud:7233`,
    cloudServiceAccountId: 'sa-1',
    apiKeyId: 'key-1',
    apiKeyExpiresAt: new Date('2027-10-05T12:00:00.000Z'),
    previousApiKeyId: null,
    previousKeyRetireAt: null,
    status: 'READY',
    step: 'ready',
    leaseExpiresAt: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const req = (path: string, method = 'POST') =>
  buildApp().request(`/tenants/${TENANT_ID}/temporal-namespace${path}`, { method })

async function body(res: Response) {
  return (await res.json()) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  process.env['TEMPORAL_PROVISIONER_FUNCTION_NAME'] = 'pegasus-staging-provisioner'
  process.env['TEMPORAL_NAMESPACE'] = 'pegasus-staging.chgel'
  process.env['TEMPORAL_TASK_QUEUE'] = 'pegasus-stdlib-staging'
  mockDb.tenant.findUnique.mockResolvedValue({ id: TENANT_ID })
  mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}))
  mockInvoke.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe('GET /tenants/:tenantId/temporal-namespace', () => {
  it('404s for an unknown tenant', async () => {
    mockDb.tenant.findUnique.mockResolvedValue(null)
    expect((await req('', 'GET')).status).toBe(404)
  })

  it('returns null data and the configured flag when there is no row', async () => {
    mockRepo.findByTenant.mockResolvedValue(null)
    const res = await req('', 'GET')
    expect(res.status).toBe(200)
    expect(await body(res)).toEqual({ data: null, configured: true })
  })

  it('reports configured=false when the provisioner is not deployed', async () => {
    delete process.env['TEMPORAL_PROVISIONER_FUNCTION_NAME']
    mockRepo.findByTenant.mockResolvedValue(null)
    expect(await body(await req('', 'GET'))).toEqual({ data: null, configured: false })
  })

  it('returns status fields and never key material or Cloud ids', async () => {
    mockRepo.findByTenant.mockResolvedValue(
      row({ leaseExpiresAt: new Date('2026-10-05T12:05:00.000Z') }),
    )
    const res = await req('', 'GET')
    const data = (await body(res))['data'] as Record<string, unknown>
    expect(data).toEqual({
      tenantId: TENANT_ID,
      namespace: NS,
      grpcAddress: `${NS}.tmprl.cloud:7233`,
      status: 'READY',
      step: 'ready',
      busy: true,
      lastError: null,
      apiKeyExpiresAt: '2027-10-05T12:00:00.000Z',
      previousKeyRetireAt: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })
    const text = JSON.stringify(data)
    for (const field of [
      'apiKeyId',
      'apiKeyCiphertext',
      'cloudServiceAccountId',
      'key-1',
      'sa-1',
    ]) {
      expect(text).not.toContain(field)
    }
  })
})

// ---------------------------------------------------------------------------
// POST (provision)
// ---------------------------------------------------------------------------

describe('POST /tenants/:tenantId/temporal-namespace (provision)', () => {
  it('503s with no row written when provisioning is not configured', async () => {
    delete process.env['TEMPORAL_PROVISIONER_FUNCTION_NAME']
    const res = await req('')
    expect(res.status).toBe(503)
    expect((await body(res))['code']).toBe('TEMPORAL_PROVISIONING_NOT_CONFIGURED')
    expect(mockRepo.createProvisioning).not.toHaveBeenCalled()
    expect(mockRepo.transition).not.toHaveBeenCalled()
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('503s when the platform namespace is not configured either', async () => {
    delete process.env['TEMPORAL_NAMESPACE']
    mockRepo.findByTenant.mockResolvedValue(null)
    expect((await req('')).status).toBe(503)
    expect(mockRepo.createProvisioning).not.toHaveBeenCalled()
  })

  it('404s for an unknown tenant', async () => {
    mockDb.tenant.findUnique.mockResolvedValue(null)
    expect((await req('')).status).toBe(404)
    expect(mockRepo.createProvisioning).not.toHaveBeenCalled()
  })

  it('creates the PROVISIONING row, audits, async-invokes provision, and returns 202', async () => {
    mockRepo.findByTenant.mockResolvedValue(null)
    mockRepo.createProvisioning.mockResolvedValue({
      outcome: 'created',
      row: row({ status: 'PROVISIONING', step: null }),
    })
    const res = await req('')
    expect(res.status).toBe(202)
    expect(mockRepo.createProvisioning).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      namespace: NS,
      grpcAddress: `${NS}.tmprl.cloud:7233`,
    })
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(),
      'admin-sub-123',
      'admin@platform.com',
      'PROVISION_TEMPORAL_NAMESPACE',
      'TENANT',
      TENANT_ID,
      null,
      expect.objectContaining({ namespace: NS, status: 'PROVISIONING' }),
      undefined,
      undefined,
    )
    expect(mockInvoke).toHaveBeenCalledWith({ action: 'provision', tenantId: TENANT_ID })
    expect(((await body(res))['data'] as Record<string, unknown>)['status']).toBe('PROVISIONING')
  })

  it('is idempotent on a READY row: 200, no invoke, no audit', async () => {
    mockRepo.findByTenant.mockResolvedValue(row())
    const res = await req('')
    expect(res.status).toBe(200)
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('does not re-invoke a PROVISIONING row whose run holds the lease', async () => {
    mockRepo.findByTenant.mockResolvedValue(
      row({ status: 'PROVISIONING', leaseExpiresAt: new Date('2026-10-05T12:10:00.000Z') }),
    )
    const res = await req('')
    expect(res.status).toBe(202)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('re-invokes a PROVISIONING row whose lease expired (a killed run)', async () => {
    mockRepo.findByTenant.mockResolvedValue(
      row({ status: 'PROVISIONING', leaseExpiresAt: new Date('2026-10-05T11:00:00.000Z') }),
    )
    const res = await req('')
    expect(res.status).toBe(202)
    expect(mockInvoke).toHaveBeenCalledWith({ action: 'provision', tenantId: TENANT_ID })
    expect(mockAudit).toHaveBeenCalledOnce()
  })

  it('resumes a FAILED row: FAILED → PROVISIONING, then invoke', async () => {
    mockRepo.findByTenant
      .mockResolvedValueOnce(row({ status: 'FAILED', lastError: 'boom' }))
      .mockResolvedValueOnce(row({ status: 'PROVISIONING' }))
    mockRepo.transition.mockResolvedValue(true)
    const res = await req('')
    expect(res.status).toBe(202)
    expect(mockRepo.transition).toHaveBeenCalledWith(TENANT_ID, ['FAILED'], 'PROVISIONING')
    expect(mockInvoke).toHaveBeenCalledWith({ action: 'provision', tenantId: TENANT_ID })
  })

  it('409s while deprovisioning', async () => {
    mockRepo.findByTenant.mockResolvedValue(row({ status: 'DEPROVISIONING' }))
    expect((await req('')).status).toBe(409)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('marks the row FAILED and 502s when the invoke fails', async () => {
    mockRepo.findByTenant.mockResolvedValue(null)
    mockRepo.createProvisioning.mockResolvedValue({
      outcome: 'created',
      row: row({ status: 'PROVISIONING' }),
    })
    mockInvoke.mockRejectedValue(new Error('throttled'))
    const res = await req('')
    expect(res.status).toBe(502)
    expect(mockRepo.markFailed).toHaveBeenCalledWith(
      TENANT_ID,
      expect.stringContaining('throttled'),
    )
  })
})

// ---------------------------------------------------------------------------
// POST /rotate-key
// ---------------------------------------------------------------------------

describe('POST /tenants/:tenantId/temporal-namespace/rotate-key', () => {
  it('503s with nothing written when not configured', async () => {
    delete process.env['TEMPORAL_PROVISIONER_FUNCTION_NAME']
    expect((await req('/rotate-key')).status).toBe(503)
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('404s when there is no namespace', async () => {
    mockRepo.findByTenant.mockResolvedValue(null)
    expect((await req('/rotate-key')).status).toBe(404)
  })

  it('409s unless READY', async () => {
    mockRepo.findByTenant.mockResolvedValue(row({ status: 'PROVISIONING' }))
    expect((await req('/rotate-key')).status).toBe(409)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('audits and async-invokes rotate on a READY row', async () => {
    mockRepo.findByTenant.mockResolvedValue(row())
    const res = await req('/rotate-key')
    expect(res.status).toBe(202)
    expect(mockAudit.mock.calls[0]![3]).toBe('ROTATE_TEMPORAL_NAMESPACE_KEY')
    expect(mockInvoke).toHaveBeenCalledWith({ action: 'rotate', tenantId: TENANT_ID })
  })
})

// ---------------------------------------------------------------------------
// POST /deprovision
// ---------------------------------------------------------------------------

describe('POST /tenants/:tenantId/temporal-namespace/deprovision', () => {
  it('503s with nothing written when not configured', async () => {
    delete process.env['TEMPORAL_PROVISIONER_FUNCTION_NAME']
    expect((await req('/deprovision')).status).toBe(503)
    expect(mockRepo.transition).not.toHaveBeenCalled()
  })

  it('404s when there is no namespace', async () => {
    mockRepo.findByTenant.mockResolvedValue(null)
    expect((await req('/deprovision')).status).toBe(404)
  })

  it.each(['READY', 'FAILED'])('moves %s → DEPROVISIONING, audits, invokes', async (status) => {
    mockRepo.findByTenant
      .mockResolvedValueOnce(row({ status }))
      .mockResolvedValueOnce(row({ status: 'DEPROVISIONING' }))
    mockRepo.transition.mockResolvedValue(true)
    const res = await req('/deprovision')
    expect(res.status).toBe(202)
    expect(mockRepo.transition).toHaveBeenCalledWith(
      TENANT_ID,
      ['READY', 'FAILED'],
      'DEPROVISIONING',
    )
    expect(mockAudit.mock.calls[0]![3]).toBe('DEPROVISION_TEMPORAL_NAMESPACE')
    expect(mockInvoke).toHaveBeenCalledWith({ action: 'deprovision', tenantId: TENANT_ID })
  })

  it('409s while provisioning', async () => {
    mockRepo.findByTenant.mockResolvedValue(row({ status: 'PROVISIONING' }))
    expect((await req('/deprovision')).status).toBe(409)
    expect(mockRepo.transition).not.toHaveBeenCalled()
  })

  it('409s when the status moved under it (lost compare-and-set)', async () => {
    mockRepo.findByTenant.mockResolvedValue(row())
    mockRepo.transition.mockResolvedValue(false)
    expect((await req('/deprovision')).status).toBe(409)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('re-invokes a DEPROVISIONING row whose lease expired, without a second transition', async () => {
    mockRepo.findByTenant.mockResolvedValue(row({ status: 'DEPROVISIONING' }))
    const res = await req('/deprovision')
    expect(res.status).toBe(202)
    expect(mockRepo.transition).not.toHaveBeenCalled()
    expect(mockInvoke).toHaveBeenCalledWith({ action: 'deprovision', tenantId: TENANT_ID })
  })
})
