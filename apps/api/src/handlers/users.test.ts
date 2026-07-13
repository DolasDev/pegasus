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
// need 403 responses set role='viewer' in buildApp.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipalForRole } from '../__tests__/_principal'
import { _clearAuthzCache } from '../lib/authz'

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
    updateRoleNames: vi.fn(),
    updateLegacyWindowsUsername: vi.fn(),
    updateLonghaulDriverId: vi.fn(),
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
  AdminResetUserPasswordCommand: vi.fn().mockImplementation(function (input: unknown) {
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
  app.use('*', seedPrincipalForRole(role))
  app.use('*', async (c, next) => {
    c.set('db', {
      tenant: { findUnique: mockTenantFindUnique },
    } as unknown as PrismaClient)
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
  legacyWindowsUsername: null,
  longhaulDriverId: null,
  role: 'USER' as const,
  roleNames: ['viewer'],
  status: 'PENDING' as const,
  invitedAt: now,
  activatedAt: null,
  deactivatedAt: null,
}

const mockAdminRow = {
  ...mockUserRow,
  id: 'admin-1',
  email: 'admin@example.com',
  roleNames: ['tenant_admin'],
  role: 'ADMIN' as const,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('users handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['AUTHZ_OFFLINE'] = 'true'
    _clearAuthzCache()
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

    it('lowercases a mixed-case email before creating the Cognito user and DB record', async () => {
      // Cognito usernames are case-sensitive, so the username we create must
      // match the lowercased address the user sees in the UI and types at
      // login — otherwise a mixed-case invite locks the user out.
      mockRepo.findByEmail.mockResolvedValue(null)
      mockSend.mockResolvedValue({})
      mockRepo.invite.mockResolvedValue(mockUserRow)

      await buildApp().request('/invite', post({ email: '  John.Doe@Example.COM ' }))

      const command = mockSend.mock.calls[0]![0] as {
        Username?: string
        UserAttributes?: Array<{ Name: string; Value: string }>
      }
      expect(command.Username).toBe('john.doe@example.com')
      expect(command.UserAttributes).toContainEqual({
        Name: 'email',
        Value: 'john.doe@example.com',
      })
      // The existing-user check and the DB record use the canonical form too.
      expect(mockRepo.findByEmail).toHaveBeenCalledWith('john.doe@example.com', 'test-tenant-id')
      expect(mockRepo.invite).toHaveBeenCalledWith(
        'test-tenant-id',
        'john.doe@example.com',
        expect.anything(),
      )
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
    it('returns 400 VALIDATION_ERROR when neither roleNames nor legacyWindowsUsername is provided', async () => {
      const res = await buildApp().request('/user-1', patch({}))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 404 NOT_FOUND when user does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null)
      const res = await buildApp().request('/user-1', patch({ roleNames: ['tenant_admin'] }))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 200 with updated user on success', async () => {
      mockRepo.findById.mockResolvedValue(mockUserRow)
      mockRepo.updateRoleNames.mockResolvedValue({
        ...mockUserRow,
        roleNames: ['tenant_admin'],
      })
      const res = await buildApp().request('/user-1', patch({ roleNames: ['tenant_admin'] }))
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['roleNames']).toEqual(['tenant_admin'])
      expect((body.data as JsonBody)['role']).toBe('ADMIN')
    })

    it('sets the longhaul driver id and returns it in the response', async () => {
      mockRepo.findById.mockResolvedValue(mockUserRow)
      mockRepo.updateLonghaulDriverId.mockResolvedValue({
        ...mockUserRow,
        longhaulDriverId: 4231,
      })
      const res = await buildApp().request('/user-1', patch({ longhaulDriverId: 4231 }))
      expect(res.status).toBe(200)
      expect(mockRepo.updateLonghaulDriverId).toHaveBeenCalledWith('user-1', 4231)
      expect(((await json(res)).data as JsonBody)['longhaulDriverId']).toBe(4231)
    })

    it('clears the longhaul driver id when null', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockUserRow, longhaulDriverId: 4231 })
      mockRepo.updateLonghaulDriverId.mockResolvedValue({ ...mockUserRow, longhaulDriverId: null })
      const res = await buildApp().request('/user-1', patch({ longhaulDriverId: null }))
      expect(res.status).toBe(200)
      expect(mockRepo.updateLonghaulDriverId).toHaveBeenCalledWith('user-1', null)
      expect(((await json(res)).data as JsonBody)['longhaulDriverId']).toBeNull()
    })

    it('rejects a non-positive longhaul driver id', async () => {
      const res = await buildApp().request('/user-1', patch({ longhaulDriverId: 0 }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
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

    it('returns 500 INTERNAL_ERROR when deactivate throws', async () => {
      mockRepo.findById.mockResolvedValue(mockUserRow)
      mockRepo.deactivate.mockRejectedValue(new Error('db error'))
      const res = await buildApp().request('/user-1', { method: 'DELETE' })
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })

    it('returns 200 with deactivated user on happy path, without touching Cognito', async () => {
      const deactivated = { ...mockUserRow, status: 'DEACTIVATED' as const, deactivatedAt: now }
      mockRepo.findById.mockResolvedValue(mockUserRow)
      mockRepo.deactivate.mockResolvedValue(deactivated)
      const res = await buildApp().request('/user-1', { method: 'DELETE' })
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['status']).toBe('DEACTIVATED')
      // The regression this guards: deactivating a user in one tenant must
      // never call a Cognito Admin*User command, since the user pool is
      // shared across every tenant on the platform (it would otherwise lock
      // the person out of every other tenant they belong to, not just this one).
      expect(mockSend).not.toHaveBeenCalled()
    })
  })

  // ── POST /:id/reactivate ──────────────────────────────────────────────────

  describe('POST /:id/reactivate', () => {
    it('returns 404 NOT_FOUND when user does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null)
      const res = await buildApp().request('/user-1/reactivate', post({}))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 422 INVALID_STATE when user is not deactivated', async () => {
      mockRepo.findById.mockResolvedValue(mockUserRow) // PENDING
      const res = await buildApp().request('/user-1/reactivate', post({}))
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('INVALID_STATE')
    })

    it('returns 200 with reactivated user on happy path, without touching Cognito', async () => {
      const deactivatedRow = { ...mockUserRow, status: 'DEACTIVATED' as const, deactivatedAt: now }
      const reactivated = { ...mockUserRow, status: 'ACTIVE' as const, deactivatedAt: null }
      mockRepo.findById.mockResolvedValue(deactivatedRow)
      mockRepo.reactivate.mockResolvedValue(reactivated)
      const res = await buildApp().request('/user-1/reactivate', post({}))
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['status']).toBe('ACTIVE')
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('returns 403 FORBIDDEN for a viewer (no ReactivateUser)', async () => {
      const res = await buildApp('viewer').request('/user-1/reactivate', post({}))
      expect(res.status).toBe(403)
    })
  })

  // ── POST /:id/reset-password ───────────────────────────────────────────────

  describe('POST /:id/reset-password', () => {
    const activeUser = { ...mockUserRow, status: 'ACTIVE' as const, activatedAt: now }

    it('returns 403 FORBIDDEN without user:update permission', async () => {
      const res = await buildApp('viewer').request('/user-1/reset-password', post({}))
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })

    it('returns 404 NOT_FOUND when the user does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null)
      const res = await buildApp().request('/missing/reset-password', post({}))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 422 INVALID_STATE when the user is not ACTIVE', async () => {
      mockRepo.findById.mockResolvedValue(mockUserRow) // PENDING
      const res = await buildApp().request('/user-1/reset-password', post({}))
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('INVALID_STATE')
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('returns 500 COGNITO_ERROR when AdminResetUserPassword fails', async () => {
      mockRepo.findById.mockResolvedValue(activeUser)
      mockSend.mockRejectedValue(
        Object.assign(new Error('boom'), { name: 'InternalErrorException' }),
      )
      const res = await buildApp().request('/user-1/reset-password', post({}))
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('COGNITO_ERROR')
    })

    it('returns 200 and calls Cognito with the user email on the happy path', async () => {
      mockRepo.findById.mockResolvedValue(activeUser)
      mockSend.mockResolvedValue({})
      const res = await buildApp().request('/user-1/reset-password', post({}))
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['email']).toBe('user@example.com')
      expect(mockSend).toHaveBeenCalledOnce()
      const sentCommand = mockSend.mock.calls[0]![0] as Record<string, unknown>
      expect(sentCommand['Username']).toBe('user@example.com')
    })
  })
})
