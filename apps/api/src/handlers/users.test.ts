// ---------------------------------------------------------------------------
// Unit tests for the users handler
//
// Cognito is mocked via vi.hoisted so the same mock function is shared
// across both the vi.mock factory and the test body.
//
// createUsersRepository is mocked to inject a plain object of vi.fn()
// methods so database calls never touch a real DB.
//
// requireRole is NOT mocked — the real implementation is used. Tests that
// need 403 responses set role='tenant_user' in buildApp.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'

// ---------------------------------------------------------------------------
// Cognito SDK mock
// ---------------------------------------------------------------------------

const { mockSend, mockRepo, mockTenantFindUnique } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockRepo: {
    listByTenant: vi.fn(),
    findById: vi.fn(),
    findByEmail: vi.fn(),
    invite: vi.fn(),
    updateRole: vi.fn(),
    updateLegacyUserId: vi.fn(),
    deactivate: vi.fn(),
    reactivate: vi.fn(),
    countAdmins: vi.fn(),
  },
  mockTenantFindUnique: vi.fn(),
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

vi.mock('../repositories/users', () => ({
  createUsersRepository: vi.fn().mockReturnValue(mockRepo),
}))

import { usersHandler } from './users'

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

function buildApp(role: string | null = 'tenant_admin') {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'test-tenant-id')
    c.set('db', {
      tenant: { findUnique: mockTenantFindUnique },
    } as unknown as PrismaClient)
    if (role !== null) c.set('role', role)
    await next()
  })
  app.route('/', usersHandler)
  return app
}

// ---------------------------------------------------------------------------
// Fixtures — use real Date objects so toISOString() works
// ---------------------------------------------------------------------------

const now = new Date('2024-01-15T12:00:00Z')

const mockUserRow = {
  id: 'user-1',
  tenantId: 'test-tenant-id',
  email: 'user@example.com',
  cognitoSub: null,
  legacyUserId: null,
  role: 'USER' as const,
  status: 'PENDING' as const,
  invitedAt: now,
  activatedAt: null,
  deactivatedAt: null,
}

const mockAdminRow = {
  ...mockUserRow,
  id: 'admin-1',
  email: 'admin@example.com',
  role: 'ADMIN' as const,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('users handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue({})
    mockTenantFindUnique.mockResolvedValue({
      id: 'test-tenant-id',
      name: 'Acme Movers',
      slug: 'acme',
    })
  })

  // ── RBAC ──────────────────────────────────────────────────────────────────

  describe('RBAC', () => {
    it('returns 403 FORBIDDEN when role is tenant_user', async () => {
      const res = await buildApp('tenant_user').request('/')
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })

    it('returns 403 FORBIDDEN when no role is set', async () => {
      const res = await buildApp(null).request('/')
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })
  })

  // ── GET / ─────────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns 200 with mapped user list on success', async () => {
      mockRepo.listByTenant.mockResolvedValue([mockUserRow])
      const res = await buildApp().request('/')
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody[]
      expect(data.length).toBe(1)
      expect(data[0]!['email']).toBe('user@example.com')
      expect(data[0]!['invitedAt']).toBe(now.toISOString())
    })

    it('returns 500 INTERNAL_ERROR on DB error', async () => {
      mockRepo.listByTenant.mockRejectedValue(new Error('db error'))
      const res = await buildApp().request('/')
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  // ── POST /invite ──────────────────────────────────────────────────────────

  describe('POST /invite', () => {
    it('returns 400 VALIDATION_ERROR when email is invalid', async () => {
      const res = await buildApp().request('/invite', post({ email: 'not-an-email' }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 409 CONFLICT when email already exists in tenant', async () => {
      mockRepo.findByEmail.mockResolvedValue(mockUserRow)
      const res = await buildApp().request('/invite', post({ email: 'user@example.com' }))
      expect(res.status).toBe(409)
      expect((await json(res)).code).toBe('CONFLICT')
    })

    it('returns 500 COGNITO_ERROR when Cognito throws a generic error', async () => {
      mockRepo.findByEmail.mockResolvedValue(null)
      mockSend.mockRejectedValue(new Error('Cognito failure'))
      const res = await buildApp().request('/invite', post({ email: 'new@example.com' }))
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('COGNITO_ERROR')
    })

    it('returns 201 when Cognito throws UsernameExistsException (idempotent)', async () => {
      mockRepo.findByEmail.mockResolvedValue(null)
      mockSend.mockRejectedValue(
        Object.assign(new Error('exists'), { name: 'UsernameExistsException' }),
      )
      mockRepo.invite.mockResolvedValue(mockUserRow)
      const res = await buildApp().request('/invite', post({ email: 'new@example.com' }))
      expect(res.status).toBe(201)
    })

    it('returns 201 on happy path (new user created)', async () => {
      mockRepo.findByEmail.mockResolvedValue(null)
      mockSend.mockResolvedValue({})
      mockRepo.invite.mockResolvedValue(mockUserRow)
      const res = await buildApp().request('/invite', post({ email: 'new@example.com' }))
      expect(res.status).toBe(201)
      const body = await json(res)
      expect((body.data as JsonBody)['email']).toBe('user@example.com')
    })

    it('passes tenant ClientMetadata to AdminCreateUserCommand for the custom-message trigger', async () => {
      mockRepo.findByEmail.mockResolvedValue(null)
      mockSend.mockResolvedValue({})
      mockRepo.invite.mockResolvedValue(mockUserRow)

      await buildApp().request('/invite', post({ email: 'new@example.com' }))

      expect(mockSend).toHaveBeenCalled()
      const command = mockSend.mock.calls[0]![0] as { ClientMetadata?: Record<string, string> }
      expect(command.ClientMetadata).toEqual({
        source: 'tenant',
        tenantId: 'test-tenant-id',
        tenantName: 'Acme Movers',
        tenantSlug: 'acme',
      })
    })

    it('returns 409 CONFLICT on race condition (P2002 from invite)', async () => {
      mockRepo.findByEmail.mockResolvedValue(null)
      mockSend.mockResolvedValue({})
      mockRepo.invite.mockRejectedValue({ code: 'P2002' })
      const res = await buildApp().request('/invite', post({ email: 'new@example.com' }))
      expect(res.status).toBe(409)
      expect((await json(res)).code).toBe('CONFLICT')
    })

    it('returns 500 INTERNAL_ERROR when invite throws an unexpected error', async () => {
      mockRepo.findByEmail.mockResolvedValue(null)
      mockSend.mockResolvedValue({})
      mockRepo.invite.mockRejectedValue(new Error('unexpected'))
      const res = await buildApp().request('/invite', post({ email: 'new@example.com' }))
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  // ── PATCH /:id ────────────────────────────────────────────────────────────

  describe('PATCH /:id', () => {
    it('returns 400 VALIDATION_ERROR when role is not in enum', async () => {
      const res = await buildApp().request('/user-1', patch({ role: 'SUPERUSER' }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 404 NOT_FOUND when user does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null)
      const res = await buildApp().request('/user-1', patch({ role: 'ADMIN' }))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 200 with updated user on success', async () => {
      mockRepo.findById.mockResolvedValue(mockUserRow)
      mockRepo.updateRole.mockResolvedValue({ ...mockUserRow, role: 'ADMIN' })
      const res = await buildApp().request('/user-1', patch({ role: 'ADMIN' }))
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['role']).toBe('ADMIN')
    })
  })

  // ── DELETE /:id ───────────────────────────────────────────────────────────

  describe('DELETE /:id', () => {
    it('returns 404 NOT_FOUND when user does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null)
      const res = await buildApp().request('/user-1', { method: 'DELETE' })
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 422 INVALID_STATE when user is already deactivated', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockUserRow, status: 'DEACTIVATED' })
      const res = await buildApp().request('/user-1', { method: 'DELETE' })
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('INVALID_STATE')
    })

    it('returns 422 LAST_ADMIN when deactivating the last active admin', async () => {
      mockRepo.findById.mockResolvedValue(mockAdminRow)
      mockRepo.countAdmins.mockResolvedValue(1)
      const res = await buildApp().request('/admin-1', { method: 'DELETE' })
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('LAST_ADMIN')
    })

    it('returns 200 when Cognito throws UserNotFoundException (fail-open)', async () => {
      mockRepo.findById.mockResolvedValue(mockUserRow)
      mockSend.mockRejectedValue(
        Object.assign(new Error('not found'), { name: 'UserNotFoundException' }),
      )
      mockRepo.deactivate.mockResolvedValue({
        ...mockUserRow,
        status: 'DEACTIVATED',
        deactivatedAt: now,
      })
      const res = await buildApp().request('/user-1', { method: 'DELETE' })
      expect(res.status).toBe(200)
    })

    it('returns 500 INTERNAL_ERROR when Cognito throws an unknown error (DB deactivate not called)', async () => {
      mockRepo.findById.mockResolvedValue(mockUserRow)
      mockSend.mockRejectedValue(new Error('Cognito failure'))
      const res = await buildApp().request('/user-1', { method: 'DELETE' })
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
      expect(mockRepo.deactivate).not.toHaveBeenCalled()
    })

    it('returns 500 INTERNAL_ERROR when deactivate throws', async () => {
      mockRepo.findById.mockResolvedValue(mockUserRow)
      mockSend.mockResolvedValue({})
      mockRepo.deactivate.mockRejectedValue(new Error('db error'))
      const res = await buildApp().request('/user-1', { method: 'DELETE' })
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })

    it('returns 200 with deactivated user on happy path', async () => {
      const deactivated = { ...mockUserRow, status: 'DEACTIVATED' as const, deactivatedAt: now }
      mockRepo.findById.mockResolvedValue(mockUserRow)
      mockSend.mockResolvedValue({})
      mockRepo.deactivate.mockResolvedValue(deactivated)
      const res = await buildApp().request('/user-1', { method: 'DELETE' })
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['status']).toBe('DEACTIVATED')
    })
  })
})
