// ---------------------------------------------------------------------------
// Handler tests for the SSO provider CRUD endpoints
//
// Tests are isolated from the full app: a minimal Hono app seeds the Hono
// context (tenantId, db, role) via a preceding middleware and mounts
// ssoHandler directly at /.
//
// requireRole is NOT mocked — the real middleware is exercised so RBAC
// enforcement is tested end-to-end through the handler.
//
// The tenant-scoped db is mocked via vi.fn() on tenantSsoProvider methods,
// so no database connection is required.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { ssoHandler } from './sso'

// ---------------------------------------------------------------------------
// Mock db
// ---------------------------------------------------------------------------

const mockDb = {
  tenantSsoProvider: {
    findMany: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

/**
 * Builds a minimal app that seeds context variables then delegates to
 * ssoHandler. Pass role=null to simulate a request where no role claim has
 * been injected into context (e.g. unauthenticated or token missing the
 * claim). Cannot use undefined because JS default params trigger on undefined.
 */
function buildApp(role: string | null = 'tenant_admin') {
  const app = new Hono<AppEnv>()

  app.use('*', async (c, next) => {
    c.set('tenantId', 'test-tenant-id')
    c.set('db', mockDb as unknown as PrismaClient)
    if (role !== null) c.set('role', role)
    await next()
  })

  app.route('/', ssoHandler)
  return app
}

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function put(body: unknown): RequestInit {
  return {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const now = new Date('2024-01-15T12:00:00Z')

const mockProviderRow = {
  id: 'provider-1',
  name: 'Google OIDC',
  type: 'OIDC' as const,
  cognitoProviderName: 'GoogleOIDC',
  metadataUrl: 'https://accounts.google.com/.well-known/openid-configuration',
  oidcClientId: 'google-client-id',
  isEnabled: true,
  createdAt: now,
  updatedAt: now,
}

const validCreateBody = {
  name: 'Google OIDC',
  type: 'OIDC',
  cognitoProviderName: 'GoogleOIDC',
  metadataUrl: 'https://accounts.google.com/.well-known/openid-configuration',
  oidcClientId: 'google-client-id',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SSO handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── RBAC enforcement ──────────────────────────────────────────────────────

  describe('RBAC enforcement', () => {
    it('returns 403 when role is tenant_user', async () => {
      const res = await buildApp('tenant_user').request('/providers')
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })

    it('returns 403 when role is absent from context', async () => {
      const res = await buildApp(null).request('/providers')
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })
  })

  // ── GET /providers ────────────────────────────────────────────────────────

  describe('GET /providers', () => {
    it('returns 200 with an empty array when no providers exist', async () => {
      mockDb.tenantSsoProvider.findMany.mockResolvedValue([])

      const res = await buildApp().request('/providers')
      expect(res.status).toBe(200)
      const body = await json(res)
      expect(body.data).toEqual([])
    })

    it('returns 200 with provider list and secretArn never present', async () => {
      // Include secretArn on the mock row to prove the response strips it
      mockDb.tenantSsoProvider.findMany.mockResolvedValue([
        { ...mockProviderRow, secretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:key' },
      ])

      const res = await buildApp().request('/providers')
      expect(res.status).toBe(200)
      const body = await json(res)
      const providers = body.data as JsonBody[]
      expect(providers).toHaveLength(1)
      expect(providers[0]!['id']).toBe('provider-1')
      expect('secretArn' in providers[0]!).toBe(false)
    })

    it('returns 500 on DB error', async () => {
      mockDb.tenantSsoProvider.findMany.mockRejectedValue(new Error('connection failed'))

      const res = await buildApp().request('/providers')
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  // ── POST /providers ───────────────────────────────────────────────────────

  describe('POST /providers', () => {
    it('returns 201 with the created provider', async () => {
      mockDb.tenantSsoProvider.create.mockResolvedValue(mockProviderRow)

      const res = await buildApp().request('/providers', post(validCreateBody))
      expect(res.status).toBe(201)
      const body = await json(res)
      const provider = body.data as JsonBody
      expect(provider['id']).toBe('provider-1')
      expect(provider['cognitoProviderName']).toBe('GoogleOIDC')
      expect(provider['type']).toBe('OIDC')
    })

    it('response never contains secretArn', async () => {
      mockDb.tenantSsoProvider.create.mockResolvedValue({
        ...mockProviderRow,
        secretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:key',
      })

      const res = await buildApp().request('/providers', post(validCreateBody))
      expect(res.status).toBe(201)
      const provider = (await json(res)).data as JsonBody
      expect('secretArn' in provider).toBe(false)
    })

    it('returns 400 VALIDATION_ERROR when name is missing', async () => {
      const { name: _name, ...bodyWithoutName } = validCreateBody
      const res = await buildApp().request('/providers', post(bodyWithoutName))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when type is not OIDC or SAML', async () => {
      const res = await buildApp().request('/providers', post({ ...validCreateBody, type: 'LDAP' }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when cognitoProviderName contains invalid characters', async () => {
      const res = await buildApp().request(
        '/providers',
        post({ ...validCreateBody, cognitoProviderName: 'bad name!' }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 409 CONFLICT when Prisma throws a P2002 unique constraint violation', async () => {
      mockDb.tenantSsoProvider.create.mockRejectedValue({ code: 'P2002' })

      const res = await buildApp().request('/providers', post(validCreateBody))
      expect(res.status).toBe(409)
      expect((await json(res)).code).toBe('CONFLICT')
    })

    it('returns 500 on unexpected DB error', async () => {
      mockDb.tenantSsoProvider.create.mockRejectedValue(new Error('timeout'))

      const res = await buildApp().request('/providers', post(validCreateBody))
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  // ── PUT /providers/:id ────────────────────────────────────────────────────

  describe('PUT /providers/:id', () => {
    it('returns 200 with the updated provider', async () => {
      const updated = { ...mockProviderRow, name: 'Renamed Provider', isEnabled: false }
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue({ id: 'provider-1' })
      mockDb.tenantSsoProvider.update.mockResolvedValue(updated)

      const res = await buildApp().request(
        '/providers/provider-1',
        put({ name: 'Renamed Provider', isEnabled: false }),
      )
      expect(res.status).toBe(200)
      const provider = (await json(res)).data as JsonBody
      expect(provider['name']).toBe('Renamed Provider')
      expect(provider['isEnabled']).toBe(false)
    })

    it('returns 404 NOT_FOUND when the provider does not exist', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(null)

      const res = await buildApp().request('/providers/missing-id', put({ name: 'X' }))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 400 VALIDATION_ERROR when metadataUrl is not a valid URL', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue({ id: 'provider-1' })

      const res = await buildApp().request(
        '/providers/provider-1',
        put({ metadataUrl: 'not-a-url' }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('does not include cognitoProviderName or type in the DB update payload', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue({ id: 'provider-1' })
      mockDb.tenantSsoProvider.update.mockResolvedValue(mockProviderRow)

      await buildApp().request('/providers/provider-1', put({ name: 'New Name' }))

      const updateCall = mockDb.tenantSsoProvider.update.mock.calls[0]![0] as {
        data: Record<string, unknown>
      }
      expect('cognitoProviderName' in updateCall.data).toBe(false)
      expect('type' in updateCall.data).toBe(false)
    })
  })

  // ── DELETE /providers/:id ─────────────────────────────────────────────────

  describe('DELETE /providers/:id', () => {
    it('returns 204 No Content on success', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue({ id: 'provider-1' })
      mockDb.tenantSsoProvider.delete.mockResolvedValue(undefined)

      const res = await buildApp().request('/providers/provider-1', { method: 'DELETE' })
      expect(res.status).toBe(204)
    })

    it('returns 404 NOT_FOUND when the provider does not exist', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(null)

      const res = await buildApp().request('/providers/missing-id', { method: 'DELETE' })
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })
  })
})
