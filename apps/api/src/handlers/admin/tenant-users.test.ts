// ---------------------------------------------------------------------------
// Unit tests for admin tenant-users handler
//
// Cognito is mocked via vi.hoisted so the same mock function is shared
// across both the vi.mock factory and the test body.
//
// createUsersRepository is mocked to inject a plain object of vi.fn() methods
// so database calls never touch a real DB.
//
// db is mocked so tenant.findUnique and $transaction are under test control.
// writeAuditLog is mocked to avoid touching the audit table.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { AdminEnv } from '../../types'

// ---------------------------------------------------------------------------
// Hoisted mocks — shared across vi.mock factories and test bodies
// ---------------------------------------------------------------------------

const { mockSend, mockRepo, mockDb } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockRepo: {
    listByTenant: vi.fn(),
    findById: vi.fn(),
    findByEmail: vi.fn(),
    invite: vi.fn(),
    updateRole: vi.fn(),
    deactivate: vi.fn(),
    countAdmins: vi.fn(),
  },
  mockDb: {
    tenant: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn().mockImplementation(function () {
    return { send: mockSend }
  }),
  AdminCreateUserCommand: vi.fn().mockImplementation(function (input: unknown) {
    return input
  }),
  AdminDisableUserCommand: vi.fn().mockImplementation(function (input: unknown) {
    return input
  }),
}))

vi.mock('../../repositories/users', () => ({
  createUsersRepository: vi.fn().mockReturnValue(mockRepo),
}))

vi.mock('../../db', () => ({ db: mockDb }))

vi.mock('./audit', () => ({ writeAuditLog: vi.fn() }))

import { adminTenantUsersRouter } from './tenant-users'

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

// Mount the router mirroring the real URL structure so :tenantId param resolves.
function buildApp() {
  const app = new Hono<AdminEnv>()
  app.use('*', async (c, next) => {
    c.set('adminSub', 'admin-sub-123')
    c.set('adminEmail', 'admin@platform.com')
    await next()
  })
  app.route('/tenants/:tenantId/users', adminTenantUsersRouter)
  return app
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date('2024-01-15T12:00:00Z')

const mockTenant = { id: 'tenant-1', name: 'Acme' }

const mockUserRow = {
  id: 'user-1',
  tenantId: 'tenant-1',
  email: 'user@acme.com',
  cognitoSub: null,
  role: 'USER' as const,
  status: 'PENDING' as const,
  invitedAt: now,
  activatedAt: null,
  deactivatedAt: null,
}

const mockAdminRow = {
  ...mockUserRow,
  id: 'admin-1',
  email: 'admin@acme.com',
  role: 'ADMIN' as const,
}

const BASE = '/tenants/tenant-1/users'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('admin tenant-users handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue({})
    mockDb.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockDb))
  })

  // ── GET / — list users ────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns 200 with user list when tenant exists', async () => {
      mockDb.tenant.findUnique.mockResolvedValue(mockTenant)
      mockRepo.listByTenant.mockResolvedValue([mockUserRow])

      const res = await buildApp().request(BASE)
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody[]
      expect(data.length).toBe(1)
      expect(data[0]!['email']).toBe('user@acme.com')
      expect(data[0]!['invitedAt']).toBe(now.toISOString())
      expect((body.meta as JsonBody)['count']).toBe(1)
    })

    it('returns 404 NOT_FOUND when tenant does not exist', async () => {
      mockDb.tenant.findUnique.mockResolvedValue(null)

      const res = await buildApp().request(BASE)
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })
  })

  // ── POST / — invite user ──────────────────────────────────────────────────

  describe('POST /', () => {
    it('returns 201 with new TenantUser on success', async () => {
      mockDb.tenant.findUnique.mockResolvedValue(mockTenant)
      mockRepo.findByEmail.mockResolvedValue(null)
      mockRepo.invite.mockResolvedValue(mockUserRow)

      const res = await buildApp().request(BASE, post({ email: 'user@acme.com' }))
      expect(res.status).toBe(201)
      const body = await json(res)
      expect((body.data as JsonBody)['email']).toBe('user@acme.com')
    })

    it('returns 404 NOT_FOUND when tenant does not exist', async () => {
      mockDb.tenant.findUnique.mockResolvedValue(null)

      const res = await buildApp().request(BASE, post({ email: 'user@acme.com' }))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 409 CONFLICT when email already in roster', async () => {
      mockDb.tenant.findUnique.mockResolvedValue(mockTenant)
      mockRepo.findByEmail.mockResolvedValue(mockUserRow)

      const res = await buildApp().request(BASE, post({ email: 'user@acme.com' }))
      expect(res.status).toBe(409)
      expect((await json(res)).code).toBe('CONFLICT')
    })

    it('returns 400 VALIDATION_ERROR when email is missing or invalid', async () => {
      mockDb.tenant.findUnique.mockResolvedValue(mockTenant)

      const res = await buildApp().request(BASE, post({ email: 'not-an-email' }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 500 COGNITO_ERROR when Cognito AdminCreateUser fails', async () => {
      mockDb.tenant.findUnique.mockResolvedValue(mockTenant)
      mockRepo.findByEmail.mockResolvedValue(null)
      mockSend.mockRejectedValue(new Error('Cognito failure'))

      const res = await buildApp().request(BASE, post({ email: 'new@acme.com' }))
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('COGNITO_ERROR')
    })

    it('returns 201 when Cognito returns UsernameExistsException (idempotent)', async () => {
      mockDb.tenant.findUnique.mockResolvedValue(mockTenant)
      mockRepo.findByEmail.mockResolvedValue(null)
      mockSend.mockRejectedValue(
        Object.assign(new Error('exists'), { name: 'UsernameExistsException' }),
      )
      mockRepo.invite.mockResolvedValue(mockUserRow)

      const res = await buildApp().request(BASE, post({ email: 'new@acme.com' }))
      expect(res.status).toBe(201)
    })
  })

  // ── PATCH /:userId — update role ──────────────────────────────────────────

  describe('PATCH /:userId', () => {
    it('returns 200 with updated user on success', async () => {
      mockRepo.findById.mockResolvedValue(mockUserRow)
      mockRepo.updateRole.mockResolvedValue({ ...mockUserRow, role: 'ADMIN' })

      const res = await buildApp().request(`${BASE}/user-1`, patch({ role: 'ADMIN' }))
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['role']).toBe('ADMIN')
    })

    it('returns 404 NOT_FOUND when user does not exist in this tenant', async () => {
      mockRepo.findById.mockResolvedValue(null)

      const res = await buildApp().request(`${BASE}/user-1`, patch({ role: 'ADMIN' }))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 400 VALIDATION_ERROR when role is invalid', async () => {
      const res = await buildApp().request(`${BASE}/user-1`, patch({ role: 'SUPERUSER' }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })
  })

  // ── DELETE /:userId — deactivate ──────────────────────────────────────────

  describe('DELETE /:userId', () => {
    it('returns 200 with deactivated user on success', async () => {
      const deactivated = { ...mockUserRow, status: 'DEACTIVATED' as const, deactivatedAt: now }
      mockRepo.findById.mockResolvedValue(mockUserRow)
      mockRepo.deactivate.mockResolvedValue(deactivated)

      const res = await buildApp().request(`${BASE}/user-1`, { method: 'DELETE' })
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['status']).toBe('DEACTIVATED')
    })

    it('returns 404 NOT_FOUND when user does not exist in this tenant', async () => {
      mockRepo.findById.mockResolvedValue(null)

      const res = await buildApp().request(`${BASE}/user-1`, { method: 'DELETE' })
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 422 INVALID_STATE when user is already deactivated', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockUserRow, status: 'DEACTIVATED' })

      const res = await buildApp().request(`${BASE}/user-1`, { method: 'DELETE' })
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('INVALID_STATE')
    })

    it('returns 422 LAST_ADMIN when deactivating the last active admin', async () => {
      mockRepo.findById.mockResolvedValue(mockAdminRow)
      mockRepo.countAdmins.mockResolvedValue(1)

      const res = await buildApp().request(`${BASE}/admin-1`, { method: 'DELETE' })
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('LAST_ADMIN')
    })

    it('returns 500 INTERNAL_ERROR when Cognito AdminDisableUser fails', async () => {
      mockRepo.findById.mockResolvedValue(mockUserRow)
      mockSend.mockRejectedValue(new Error('Cognito failure'))

      const res = await buildApp().request(`${BASE}/user-1`, { method: 'DELETE' })
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
      expect(mockRepo.deactivate).not.toHaveBeenCalled()
    })

    it('returns 200 when Cognito returns UserNotFoundException (fail-open)', async () => {
      const deactivated = { ...mockUserRow, status: 'DEACTIVATED' as const, deactivatedAt: now }
      mockRepo.findById.mockResolvedValue(mockUserRow)
      mockSend.mockRejectedValue(
        Object.assign(new Error('not found'), { name: 'UserNotFoundException' }),
      )
      mockRepo.deactivate.mockResolvedValue(deactivated)

      const res = await buildApp().request(`${BASE}/user-1`, { method: 'DELETE' })
      expect(res.status).toBe(200)
    })
  })
})
