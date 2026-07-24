// ---------------------------------------------------------------------------
// Unit tests for the api-clients handler
//
// createApiClientRepository is mocked so no DB is required.
// requireRole is NOT mocked — the real implementation enforces RBAC.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipalForRole } from '../__tests__/_principal'
import { _clearAuthzCache } from '../lib/authz'

// ---------------------------------------------------------------------------
// Mock the repository
// ---------------------------------------------------------------------------

const { mockRepo, mockTx, mockDb } = vi.hoisted(() => ({
  mockRepo: {
    create: vi.fn(),
    listByTenant: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    revoke: vi.fn(),
    rotate: vi.fn(),
    deleteWithServiceAccount: vi.fn(),
    touchLastUsed: vi.fn(),
  },
  mockTx: {
    tenantUser: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  mockDb: {
    // The DELETE handler reads the Workflow table directly to guard against
    // deleting a live workflow-runtime credential.
    workflow: { findFirst: vi.fn() },
  },
}))

vi.mock('../repositories/api-client.repository', () => ({
  createApiClientRepository: vi.fn(() => mockRepo),
}))

import { apiClientsHandler } from './api-clients'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function patch(body: unknown): RequestInit {
  return {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function buildApp(role: string | null = 'tenant_admin', userId = 'user-1') {
  const fakeDb = {
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(mockTx),
    workflow: mockDb.workflow,
  } as unknown as PrismaClient
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', seedPrincipalForRole(role))
  app.use('*', async (c, next) => {
    c.set('db', fakeDb)
    c.set('userId', userId)
    await next()
  })
  app.route('/', apiClientsHandler)
  return app
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date('2024-01-15T12:00:00Z')

const mockRow = {
  id: 'client-1',
  tenantId: 'test-tenant-id',
  name: 'Test Client',
  keyPrefix: 'vnd_a1b2c3d4',
  scopes: [] as string[],
  lastUsedAt: null,
  revokedAt: null,
  createdById: 'user-1',
  actsAsUserId: 'svc-user-1',
  roleNames: ['integrations'],
  createdAt: now,
  updatedAt: now,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api-clients handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['AUTHZ_OFFLINE'] = 'true'
    _clearAuthzCache()
  })

  // ── RBAC ──────────────────────────────────────────────────────────────────

  describe('RBAC', () => {
    it('returns 403 FORBIDDEN when role is tenant_user', async () => {
      const res = await buildApp('viewer').request('/')
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })

    it('returns 403 FORBIDDEN when no role is set', async () => {
      const res = await buildApp(null).request('/')
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })
  })

  // ── POST / ────────────────────────────────────────────────────────────────

  describe('POST /', () => {
    it('returns 400 VALIDATION_ERROR when name is missing', async () => {
      const res = await buildApp().request('/', post({ roleNames: ['integrations'] }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when roleNames is missing', async () => {
      const res = await buildApp().request('/', post({ name: 'My Client' }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when roleNames is empty array', async () => {
      const res = await buildApp().request('/', post({ name: 'My Client', roleNames: [] }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 201 with data and plainKey on success', async () => {
      mockTx.tenantUser.create.mockResolvedValue({})
      mockRepo.create.mockResolvedValue({ row: mockRow, plainKey: 'vnd_theplainkey' })
      const res = await buildApp().request(
        '/',
        post({ name: 'My Client', roleNames: ['integrations'] }),
      )
      expect(res.status).toBe(201)
      const body = await json(res)
      const data = body.data as JsonBody
      expect(data['name']).toBe('Test Client')
      expect(data['plainKey']).toBe('vnd_theplainkey')
      expect(data['roleNames']).toEqual(['integrations'])
      expect(data['actsAsUserId']).toBe('svc-user-1')
      // keyHash and freeform scopes must never appear in response
      expect('keyHash' in data).toBe(false)
      expect('scopes' in data).toBe(false)
    })

    it('provisions a service-account TenantUser with isServiceAccount=true', async () => {
      mockTx.tenantUser.create.mockResolvedValue({})
      mockRepo.create.mockResolvedValue({ row: mockRow, plainKey: 'vnd_key' })
      await buildApp('tenant_admin', 'user-42').request(
        '/',
        post({ name: 'Vendor Bot', roleNames: ['reporting'] }),
      )
      expect(mockTx.tenantUser.create).toHaveBeenCalledOnce()
      const args = mockTx.tenantUser.create.mock.calls[0]![0] as { data: Record<string, unknown> }
      expect(args.data['tenantId']).toBe('test-tenant-id')
      expect(args.data['isServiceAccount']).toBe(true)
      expect(args.data['cognitoSub']).toBeNull()
      expect(args.data['status']).toBe('ACTIVE')
      expect(args.data['roleNames']).toEqual(['reporting'])
      // The api-client is bound to the same id minted for the service account
      expect(mockRepo.create).toHaveBeenCalledWith(
        'test-tenant-id',
        'Vendor Bot',
        [],
        'user-42',
        args.data['id'],
      )
    })

    it('returns 500 INTERNAL_ERROR when repo.create throws inside the tx', async () => {
      mockTx.tenantUser.create.mockResolvedValue({})
      mockRepo.create.mockRejectedValue(new Error('db error'))
      const res = await buildApp().request(
        '/',
        post({ name: 'My Client', roleNames: ['integrations'] }),
      )
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  // ── GET / ─────────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns 200 with list of clients (no keyHash, no plainKey)', async () => {
      mockRepo.listByTenant.mockResolvedValue([mockRow])
      const res = await buildApp().request('/')
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody[]
      expect(data.length).toBe(1)
      expect(data[0]!['name']).toBe('Test Client')
      expect('keyHash' in data[0]!).toBe(false)
      expect('plainKey' in data[0]!).toBe(false)
      expect((body.meta as JsonBody)['count']).toBe(1)
    })

    it('returns 403 when role is not tenant_admin', async () => {
      const res = await buildApp('viewer').request('/')
      expect(res.status).toBe(403)
    })

    it('returns 500 INTERNAL_ERROR on DB error', async () => {
      mockRepo.listByTenant.mockRejectedValue(new Error('db error'))
      const res = await buildApp().request('/')
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  // ── GET /:id ──────────────────────────────────────────────────────────────

  describe('GET /:id', () => {
    it('returns 200 with client when found', async () => {
      mockRepo.findById.mockResolvedValue(mockRow)
      const res = await buildApp().request('/client-1')
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['id']).toBe('client-1')
    })

    it('returns 404 NOT_FOUND when client does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null)
      const res = await buildApp().request('/client-1')
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 404 NOT_FOUND when client belongs to a different tenant', async () => {
      // findById already checks tenantId — returning null means wrong tenant
      mockRepo.findById.mockResolvedValue(null)
      const res = await buildApp().request('/client-1')
      expect(res.status).toBe(404)
    })
  })

  // ── PATCH /:id ────────────────────────────────────────────────────────────

  describe('PATCH /:id', () => {
    it('returns 400 VALIDATION_ERROR when neither name nor roleNames is provided', async () => {
      const res = await buildApp().request('/client-1', patch({}))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 404 NOT_FOUND when client does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null)
      const res = await buildApp().request('/client-1', patch({ name: 'New Name' }))
      expect(res.status).toBe(404)
    })

    it('returns 200 with updated client on name update', async () => {
      mockRepo.findById.mockResolvedValue(mockRow)
      mockRepo.update.mockResolvedValue({ ...mockRow, name: 'Updated Name' })
      const res = await buildApp().request('/client-1', patch({ name: 'Updated Name' }))
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['name']).toBe('Updated Name')
      expect(mockTx.tenantUser.update).not.toHaveBeenCalled()
    })

    it('returns 200 with updated client on roleNames update', async () => {
      mockRepo.findById
        .mockResolvedValueOnce(mockRow) // initial lookup
        .mockResolvedValueOnce({ ...mockRow, roleNames: ['reporting'] }) // re-read inside tx
      mockTx.tenantUser.update.mockResolvedValue({})
      const res = await buildApp().request('/client-1', patch({ roleNames: ['reporting'] }))
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['roleNames']).toEqual(['reporting'])
      expect(mockTx.tenantUser.update).toHaveBeenCalledWith({
        where: { id: 'svc-user-1' },
        data: { roleNames: ['reporting'] },
      })
      expect(mockRepo.update).not.toHaveBeenCalled()
    })

    it('returns 409 STALE_API_CLIENT when patching roleNames on a stale row', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockRow, actsAsUserId: null, roleNames: [] })
      const res = await buildApp().request('/client-1', patch({ roleNames: ['reporting'] }))
      expect(res.status).toBe(409)
      expect((await json(res)).code).toBe('STALE_API_CLIENT')
    })
  })

  // ── POST /:id/revoke ──────────────────────────────────────────────────────

  describe('POST /:id/revoke', () => {
    it('returns 404 NOT_FOUND when client does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null)
      const res = await buildApp().request('/client-1/revoke', { method: 'POST' })
      expect(res.status).toBe(404)
    })

    it('returns 409 CONFLICT when client is already revoked', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockRow, revokedAt: now })
      const res = await buildApp().request('/client-1/revoke', { method: 'POST' })
      expect(res.status).toBe(409)
      expect((await json(res)).code).toBe('CONFLICT')
    })

    it('returns 200 with revokedAt set on success', async () => {
      mockRepo.findById.mockResolvedValue(mockRow)
      mockRepo.revoke.mockResolvedValue({ ...mockRow, revokedAt: now })
      const res = await buildApp().request('/client-1/revoke', { method: 'POST' })
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['revokedAt']).toBe(now.toISOString())
    })
  })

  // ── POST /:id/rotate ──────────────────────────────────────────────────────

  describe('POST /:id/rotate', () => {
    it('returns 404 NOT_FOUND when client does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null)
      const res = await buildApp().request('/client-1/rotate', { method: 'POST' })
      expect(res.status).toBe(404)
    })

    it('returns 200 with new plainKey on success', async () => {
      mockRepo.findById.mockResolvedValue(mockRow)
      mockRepo.rotate.mockResolvedValue({
        row: { ...mockRow, keyPrefix: 'vnd_newprefix', revokedAt: null },
        plainKey: 'vnd_newplainkey',
      })
      const res = await buildApp().request('/client-1/rotate', { method: 'POST' })
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody
      expect(data['plainKey']).toBe('vnd_newplainkey')
      expect('keyHash' in data).toBe(false)
    })
  })

  // ── DELETE /:id ───────────────────────────────────────────────────────────

  describe('DELETE /:id', () => {
    it('returns 404 NOT_FOUND when client does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null)
      const res = await buildApp().request('/client-1', { method: 'DELETE' })
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
      expect(mockRepo.deleteWithServiceAccount).not.toHaveBeenCalled()
    })

    it('returns 409 RUNTIME_CLIENT_IN_USE when the key is a workflow runtime credential', async () => {
      mockRepo.findById.mockResolvedValue(mockRow)
      mockDb.workflow.findFirst.mockResolvedValue({ id: 'wf-1', name: 'nightly-sync' })
      const res = await buildApp().request('/client-1', { method: 'DELETE' })
      expect(res.status).toBe(409)
      expect((await json(res)).code).toBe('RUNTIME_CLIENT_IN_USE')
      expect(mockRepo.deleteWithServiceAccount).not.toHaveBeenCalled()
    })

    it('returns 200 and hard-deletes the key + service account on success', async () => {
      mockRepo.findById.mockResolvedValue(mockRow)
      mockDb.workflow.findFirst.mockResolvedValue(null)
      mockRepo.deleteWithServiceAccount.mockResolvedValue(undefined)
      const res = await buildApp().request('/client-1', { method: 'DELETE' })
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody
      expect(data['id']).toBe('client-1')
      expect(data['deleted']).toBe(true)
      expect(mockRepo.deleteWithServiceAccount).toHaveBeenCalledWith('client-1', 'test-tenant-id')
    })

    it('returns 403 FORBIDDEN when role lacks api_client:delete', async () => {
      const res = await buildApp('viewer').request('/client-1', { method: 'DELETE' })
      expect(res.status).toBe(403)
      expect(mockRepo.deleteWithServiceAccount).not.toHaveBeenCalled()
    })
  })
})
