// ---------------------------------------------------------------------------
// Handler tests for the SSO provider CRUD endpoints
//
// Tests are isolated from the full app: a minimal Hono app seeds the Hono
// context (tenantId, db, role) via a preceding middleware and mounts
// ssoHandler directly at /.
//
// The tenant-scoped db is mocked via vi.fn() on tenantSsoProvider methods,
// so no database connection is required.
//
// The @aws-sdk/client-cognito-identity-provider module is mocked so Cognito
// calls are captured and verified without hitting AWS.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { ssoHandler } from './sso'
import {
  CreateIdentityProviderCommand,
  UpdateIdentityProviderCommand,
  DeleteIdentityProviderCommand,
} from '@aws-sdk/client-cognito-identity-provider'

// ---------------------------------------------------------------------------
// Cognito SDK mock
// ---------------------------------------------------------------------------

const { mockSend } = vi.hoisted(() => {
  const mockSend = vi.fn()
  return { mockSend }
})

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn().mockImplementation(() => ({ send: mockSend })),
  CreateIdentityProviderCommand: vi.fn((input: unknown) => input),
  UpdateIdentityProviderCommand: vi.fn((input: unknown) => input),
  DeleteIdentityProviderCommand: vi.fn((input: unknown) => input),
}))

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
  tenant: {
    findUnique: vi.fn(),
    update: vi.fn(),
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

/** Full row shape returned by findUnique in PUT — includes Cognito call context fields. */
const mockExistingRow = {
  id: 'provider-1',
  cognitoProviderName: 'GoogleOIDC',
  type: 'OIDC' as const,
  metadataUrl: 'https://accounts.google.com/.well-known/openid-configuration',
  oidcClientId: 'google-client-id',
}

/** Minimal row shape returned by findUnique in DELETE. */
const mockDeleteRow = { id: 'provider-1', cognitoProviderName: 'GoogleOIDC' }

const validCreateBody = {
  name: 'Google OIDC',
  type: 'OIDC',
  cognitoProviderName: 'GoogleOIDC',
  metadataUrl: 'https://accounts.google.com/.well-known/openid-configuration',
  oidcClientId: 'google-client-id',
}

const validSamlCreateBody = {
  name: 'Okta SAML',
  type: 'SAML',
  cognitoProviderName: 'OktaSAML',
  metadataUrl: 'https://okta.example.com/metadata',
}

const mockSamlProviderRow = {
  ...mockProviderRow,
  id: 'provider-2',
  name: 'Okta SAML',
  type: 'SAML' as const,
  cognitoProviderName: 'OktaSAML',
  metadataUrl: 'https://okta.example.com/metadata',
  oidcClientId: null,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SSO handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: Cognito calls succeed unless overridden in a specific test
    mockSend.mockResolvedValue({})
    // Default: tenant exists with cognitoAuthEnabled true
    mockDb.tenant.findUnique.mockResolvedValue({ cognitoAuthEnabled: true })
  })

  // ── Role access ───────────────────────────────────────────────────────────
  // Phase 5 will restrict provider management to tenant_admin only.
  // Until then, any authenticated tenant session (including tenant_user) can
  // manage providers. The RBAC check is intentionally absent here.

  describe('role access', () => {
    it('allows access for role tenant_user', async () => {
      mockDb.tenantSsoProvider.findMany.mockResolvedValue([])
      const res = await buildApp('tenant_user').request('/providers')
      expect(res.status).toBe(200)
    })

    it('allows access when no role is set in context', async () => {
      mockDb.tenantSsoProvider.findMany.mockResolvedValue([])
      const res = await buildApp(null).request('/providers')
      expect(res.status).toBe(200)
    })
  })

  // ── GET /providers ────────────────────────────────────────────────────────

  describe('GET /providers', () => {
    it('returns 200 with an empty array when no providers exist', async () => {
      mockDb.tenantSsoProvider.findMany.mockResolvedValue([])

      const res = await buildApp().request('/providers')
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody
      expect(data['providers']).toEqual([])
      expect(data['cognitoAuthEnabled']).toBe(true)
    })

    it('returns 200 with provider list and secretArn never present', async () => {
      // Include secretArn on the mock row to prove the response strips it
      mockDb.tenantSsoProvider.findMany.mockResolvedValue([
        { ...mockProviderRow, secretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:key' },
      ])

      const res = await buildApp().request('/providers')
      expect(res.status).toBe(200)
      const body = await json(res)
      const providers = (body.data as JsonBody)['providers'] as JsonBody[]
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
      const { name: _name, ...bodyWithoutName } = validCreateBody // eslint-disable-line @typescript-eslint/no-unused-vars
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

    // ── POST — Cognito provisioning ──────────────────────────────────────────

    it('calls CreateIdentityProviderCommand with correct OIDC ProviderDetails', async () => {
      mockDb.tenantSsoProvider.create.mockResolvedValue(mockProviderRow)

      const res = await buildApp().request(
        '/providers',
        post({ ...validCreateBody, oidcClientSecret: 'super-secret' }),
      )
      expect(res.status).toBe(201)

      expect(CreateIdentityProviderCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          UserPoolId: expect.any(String),
          ProviderName: 'GoogleOIDC',
          ProviderType: 'OIDC',
          ProviderDetails: expect.objectContaining({
            authorize_scopes: 'openid email profile',
            client_id: 'google-client-id',
            client_secret: 'super-secret',
            attributes_request_method: 'GET',
          }),
          AttributeMapping: { email: 'email' },
        }),
      )
    })

    it('calls CreateIdentityProviderCommand with ProviderType SAML for SAML provider', async () => {
      mockDb.tenantSsoProvider.create.mockResolvedValue(mockSamlProviderRow)

      const res = await buildApp().request('/providers', post(validSamlCreateBody))
      expect(res.status).toBe(201)

      expect(CreateIdentityProviderCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ProviderName: 'OktaSAML',
          ProviderType: 'SAML',
          ProviderDetails: expect.objectContaining({
            MetadataURL: 'https://okta.example.com/metadata',
          }),
        }),
      )
      // SAML providers do not get authorize_scopes
      const call = (CreateIdentityProviderCommand as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0]![0]
      expect(
        (call as { ProviderDetails: Record<string, string> }).ProviderDetails,
      ).not.toHaveProperty('authorize_scopes')
    })

    it('rolls back the DB record and returns 500 when Cognito CreateIdentityProvider fails', async () => {
      mockDb.tenantSsoProvider.create.mockResolvedValue(mockProviderRow)
      mockDb.tenantSsoProvider.delete.mockResolvedValue(undefined)
      mockSend.mockRejectedValue(new Error('Cognito error'))

      const res = await buildApp().request('/providers', post(validCreateBody))
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
      expect(mockDb.tenantSsoProvider.delete).toHaveBeenCalledWith({
        where: { id: 'provider-1' },
      })
    })
  })

  // ── PUT /providers/:id ────────────────────────────────────────────────────

  describe('PUT /providers/:id', () => {
    it('returns 200 with the updated provider', async () => {
      const updated = { ...mockProviderRow, name: 'Renamed Provider', isEnabled: false }
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockExistingRow)
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
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockExistingRow)

      const res = await buildApp().request(
        '/providers/provider-1',
        put({ metadataUrl: 'not-a-url' }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('does not include cognitoProviderName or type in the DB update payload', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockExistingRow)
      mockDb.tenantSsoProvider.update.mockResolvedValue(mockProviderRow)

      await buildApp().request('/providers/provider-1', put({ name: 'New Name' }))

      const updateCall = mockDb.tenantSsoProvider.update.mock.calls[0]![0] as {
        data: Record<string, unknown>
      }
      expect('cognitoProviderName' in updateCall.data).toBe(false)
      expect('type' in updateCall.data).toBe(false)
    })

    // ── PUT — Cognito sync ───────────────────────────────────────────────────

    it('calls UpdateIdentityProviderCommand with cognitoProviderName and authorize_scopes for OIDC', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockExistingRow)
      mockDb.tenantSsoProvider.update.mockResolvedValue(mockProviderRow)

      const res = await buildApp().request('/providers/provider-1', put({ name: 'Renamed' }))
      expect(res.status).toBe(200)

      expect(UpdateIdentityProviderCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          UserPoolId: expect.any(String),
          ProviderName: 'GoogleOIDC',
          ProviderDetails: expect.objectContaining({
            authorize_scopes: 'openid email profile',
          }),
        }),
      )
    })

    it('includes client_secret in UpdateIdentityProviderCommand only when oidcClientSecret is provided', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockExistingRow)
      mockDb.tenantSsoProvider.update.mockResolvedValue(mockProviderRow)

      await buildApp().request('/providers/provider-1', put({ oidcClientSecret: 'new-secret' }))

      const call = (UpdateIdentityProviderCommand as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0]![0]
      expect(
        (call as { ProviderDetails: Record<string, string> }).ProviderDetails['client_secret'],
      ).toBe('new-secret')
    })

    it('returns 500 and does not retry when Cognito UpdateIdentityProvider fails', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockExistingRow)
      mockDb.tenantSsoProvider.update.mockResolvedValue(mockProviderRow)
      mockSend.mockRejectedValue(new Error('Cognito error'))

      const res = await buildApp().request('/providers/provider-1', put({ name: 'X' }))
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  // ── DELETE /providers/:id ─────────────────────────────────────────────────

  describe('DELETE /providers/:id', () => {
    it('returns 204 No Content on success', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockDeleteRow)
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

    // ── DELETE — Cognito cleanup ─────────────────────────────────────────────

    it('calls DeleteIdentityProviderCommand with the provider cognitoProviderName', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockDeleteRow)
      mockDb.tenantSsoProvider.delete.mockResolvedValue(undefined)

      const res = await buildApp().request('/providers/provider-1', { method: 'DELETE' })
      expect(res.status).toBe(204)

      expect(DeleteIdentityProviderCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          UserPoolId: expect.any(String),
          ProviderName: 'GoogleOIDC',
        }),
      )
    })

    it('treats ResourceNotFoundException from Cognito as idempotent and still deletes DB record', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockDeleteRow)
      mockDb.tenantSsoProvider.delete.mockResolvedValue(undefined)
      const err = Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' })
      mockSend.mockRejectedValue(err)

      const res = await buildApp().request('/providers/provider-1', { method: 'DELETE' })
      expect(res.status).toBe(204)
      expect(mockDb.tenantSsoProvider.delete).toHaveBeenCalledWith({ where: { id: 'provider-1' } })
    })

    it('treats NotAuthorizedException from Cognito as idempotent and still deletes DB record', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockDeleteRow)
      mockDb.tenantSsoProvider.delete.mockResolvedValue(undefined)
      const err = Object.assign(new Error('not authorized'), { name: 'NotAuthorizedException' })
      mockSend.mockRejectedValue(err)

      const res = await buildApp().request('/providers/provider-1', { method: 'DELETE' })
      expect(res.status).toBe(204)
      expect(mockDb.tenantSsoProvider.delete).toHaveBeenCalledWith({ where: { id: 'provider-1' } })
    })

    it('returns 500 and preserves DB record on other Cognito DELETE errors', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockDeleteRow)
      mockSend.mockRejectedValue(new Error('Cognito internal error'))

      const res = await buildApp().request('/providers/provider-1', { method: 'DELETE' })
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
      expect(mockDb.tenantSsoProvider.delete).not.toHaveBeenCalled()
    })
  })
})
