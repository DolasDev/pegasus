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
  UpdateUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider'

// ---------------------------------------------------------------------------
// Cognito SDK mock
// ---------------------------------------------------------------------------

const { mockSend } = vi.hoisted(() => {
  const mockSend = vi.fn()
  return { mockSend }
})

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn().mockImplementation(function () {
    return { send: mockSend }
  }),
  CreateIdentityProviderCommand: vi.fn().mockImplementation(function (input: unknown) {
    return input
  }),
  UpdateIdentityProviderCommand: vi.fn().mockImplementation(function (input: unknown) {
    return input
  }),
  DeleteIdentityProviderCommand: vi.fn().mockImplementation(function (input: unknown) {
    return input
  }),
  // Tagged so the shared mockSend can tell an app-client read from every other call.
  // The IdP commands above stay untagged — existing assertions read their constructor
  // args, which this does not touch.
  DescribeUserPoolClientCommand: vi.fn().mockImplementation(function (input: unknown) {
    return { __cmd: 'DescribeUserPoolClient', ...(input as object) }
  }),
  UpdateUserPoolClientCommand: vi.fn().mockImplementation(function (input: unknown) {
    return { __cmd: 'UpdateUserPoolClient', ...(input as object) }
  }),
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
 * ssoHandler.
 */
function buildApp() {
  const app = new Hono<AppEnv>()

  app.use('*', async (c, next) => {
    c.set('tenantId', 'test-tenant-id')
    c.set('db', mockDb as unknown as PrismaClient)
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
  oidcClientSecret: 'google-client-secret',
}

const validSamlCreateBody = {
  name: 'Okta SAML',
  type: 'SAML',
  cognitoProviderName: 'OktaSAML',
  metadataUrl: 'https://okta.example.com/metadata',
}

/** What DescribeUserPoolClient returns for the tenant app client. */
const mockAppClient = {
  UserPoolId: 'us-east-1_TESTPOOL',
  ClientId: 'tenant-client-id',
  ClientName: 'tenant-app-client',
  SupportedIdentityProviders: ['COGNITO'],
  CallbackURLs: ['https://pegasus.example.dev/login/callback'],
  ExplicitAuthFlows: ['ALLOW_REFRESH_TOKEN_AUTH', 'ALLOW_USER_PASSWORD_AUTH'],
  AllowedOAuthFlows: ['code'],
  AllowedOAuthScopes: ['email', 'openid', 'profile'],
}

/** The SupportedIdentityProviders list from the Nth app-client write. */
function appClientWrites(): string[][] {
  return mockSend.mock.calls
    .map((c) => c[0] as { __cmd?: string; SupportedIdentityProviders?: string[] })
    .filter((c) => c.__cmd === 'UpdateUserPoolClient')
    .map((c) => c.SupportedIdentityProviders ?? [])
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
    // Default: Cognito calls succeed unless overridden in a specific test. The app
    // client must describe as a real client — sso.ts read-modify-writes it, so an
    // empty response would (correctly) blow up the provider create path.
    mockSend.mockImplementation(async (cmd: { __cmd?: string }) => {
      if (cmd?.__cmd === 'DescribeUserPoolClient') {
        return { UserPoolClient: { ...mockAppClient } }
      }
      return {}
    })
    // Default: tenant exists with cognitoAuthEnabled true
    mockDb.tenant.findUnique.mockResolvedValue({ cognitoAuthEnabled: true })
  })

  // ── Role access ───────────────────────────────────────────────────────────
  // Phase 5 will restrict provider management to tenant_admin only.
  // Until then, any authenticated tenant session (including tenant_user) can
  // manage providers. The RBAC check is intentionally absent here.

  describe('role access', () => {
    it('allows access regardless of role (RBAC will tighten in a later phase)', async () => {
      mockDb.tenantSsoProvider.findMany.mockResolvedValue([])
      const res = await buildApp().request('/providers')
      expect(res.status).toBe(200)
    })
  })

  // ── GET /providers ────────────────────────────────────────────────────────

  describe('GET /providers', () => {
    // CFN owns SupportedIdentityProviders (CDK's addClient renders it), so a CDK edit
    // to the tenant app client silently resets the list and kills SSO for everyone.
    // Reconciling on read means the next settings-page load repairs it.
    it('repairs app client drift left behind by a CloudFormation reset', async () => {
      mockDb.tenantSsoProvider.findMany.mockResolvedValue([mockProviderRow])

      const res = await buildApp().request('/providers')

      expect(res.status).toBe(200)
      expect(appClientWrites()).toEqual([['COGNITO', 'GoogleOIDC']])
    })

    it('does not touch the app client when nothing has drifted', async () => {
      mockDb.tenantSsoProvider.findMany.mockResolvedValue([mockProviderRow])
      mockSend.mockImplementation(async (cmd: { __cmd?: string }) => {
        if (cmd?.__cmd === 'DescribeUserPoolClient') {
          return {
            UserPoolClient: {
              ...mockAppClient,
              SupportedIdentityProviders: ['COGNITO', 'GoogleOIDC'],
            },
          }
        }
        return {}
      })

      await buildApp().request('/providers')

      expect(appClientWrites()).toEqual([])
    })

    it('does not re-enable a disabled provider on the app client', async () => {
      mockDb.tenantSsoProvider.findMany.mockResolvedValue([
        { ...mockProviderRow, isEnabled: false },
      ])

      await buildApp().request('/providers')

      expect(appClientWrites()).toEqual([])
    })

    // A failed repair must never take the settings page down with it.
    it('still returns 200 when the app client reconcile fails', async () => {
      mockDb.tenantSsoProvider.findMany.mockResolvedValue([mockProviderRow])
      mockSend.mockRejectedValue(new Error('AccessDeniedException'))

      const res = await buildApp().request('/providers')

      expect(res.status).toBe(200)
      expect((await json(res)).data).toBeDefined()
    })

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

    // An OIDC provider registered without a client secret cannot complete the
    // authorization-code exchange — Cognito returns 400 at /oauth2/idpresponse.
    // Reject the shape up front rather than registering an IdP that can never work.
    it('returns 400 VALIDATION_ERROR when an OIDC provider has no oidcClientSecret', async () => {
      const { oidcClientSecret: _omitted, ...noSecret } = validCreateBody

      const res = await buildApp().request('/providers', post(noSecret))

      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
      expect(mockDb.tenantSsoProvider.create).not.toHaveBeenCalled()
      expect(CreateIdentityProviderCommand).not.toHaveBeenCalled()
    })

    it('returns 400 VALIDATION_ERROR when an OIDC provider has no oidcClientId', async () => {
      const { oidcClientId: _omitted, ...noClientId } = validCreateBody

      const res = await buildApp().request('/providers', post(noClientId))

      expect(res.status).toBe(400)
      expect(CreateIdentityProviderCommand).not.toHaveBeenCalled()
    })

    it('returns 400 VALIDATION_ERROR when an OIDC provider has no metadataUrl', async () => {
      const { metadataUrl: _omitted, ...noMetadata } = validCreateBody

      const res = await buildApp().request('/providers', post(noMetadata))

      expect(res.status).toBe(400)
      expect(CreateIdentityProviderCommand).not.toHaveBeenCalled()
    })

    // The UI marks metadata URL required for SAML, but a direct API call could
    // still register a SAML IdP with empty ProviderDetails, which Cognito rejects.
    it('returns 400 VALIDATION_ERROR when a SAML provider has no metadataUrl', async () => {
      const { metadataUrl: _omitted, ...noMetadata } = validSamlCreateBody

      const res = await buildApp().request('/providers', post(noMetadata))

      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
      expect(CreateIdentityProviderCommand).not.toHaveBeenCalled()
    })

    it('accepts a SAML provider without any OIDC fields', async () => {
      mockDb.tenantSsoProvider.create.mockResolvedValue(mockSamlProviderRow)

      const res = await buildApp().request('/providers', post(validSamlCreateBody))

      expect(res.status).toBe(201)
    })

    it('returns 409 CONFLICT when Cognito rejects the provider name as a duplicate', async () => {
      mockDb.tenantSsoProvider.create.mockResolvedValue(mockProviderRow)
      mockDb.tenantSsoProvider.delete.mockResolvedValue(undefined)
      const err = Object.assign(new Error('duplicate'), { name: 'DuplicateProviderException' })
      mockSend.mockRejectedValue(err)

      const res = await buildApp().request('/providers', post(validCreateBody))

      expect(res.status).toBe(409)
      expect((await json(res)).code).toBe('CONFLICT')
      // The DB row must still be rolled back, exactly as on any other Cognito failure.
      expect(mockDb.tenantSsoProvider.delete).toHaveBeenCalledWith({
        where: { id: 'provider-1' },
      })
    })

    // Registering the IdP is not enough — without the app client permitting it, Cognito
    // redirects to the IdP, takes the code back, then 400s at /oauth2/idpresponse with
    // no error_description. This is the regression guard for that.
    it('permits the new provider on the tenant app client', async () => {
      mockDb.tenantSsoProvider.create.mockResolvedValue(mockProviderRow)

      const res = await buildApp().request('/providers', post(validCreateBody))

      expect(res.status).toBe(201)
      expect(appClientWrites()).toEqual([['COGNITO', 'GoogleOIDC']])
    })

    it('preserves the app client config when permitting the provider', async () => {
      mockDb.tenantSsoProvider.create.mockResolvedValue(mockProviderRow)

      await buildApp().request('/providers', post(validCreateBody))

      // UpdateUserPoolClient replaces the whole config — dropping these would break
      // password login for every tenant, not just SSO.
      expect(UpdateUserPoolClientCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          CallbackURLs: mockAppClient.CallbackURLs,
          ExplicitAuthFlows: mockAppClient.ExplicitAuthFlows,
          AllowedOAuthScopes: mockAppClient.AllowedOAuthScopes,
        }),
      )
    })

    it('rolls back the IdP and the DB row when the app client update fails', async () => {
      mockDb.tenantSsoProvider.create.mockResolvedValue(mockProviderRow)
      mockDb.tenantSsoProvider.delete.mockResolvedValue(undefined)
      mockSend.mockImplementation(async (cmd: { __cmd?: string }) => {
        if (cmd?.__cmd === 'DescribeUserPoolClient') return { UserPoolClient: { ...mockAppClient } }
        if (cmd?.__cmd === 'UpdateUserPoolClient') throw new Error('AccessDeniedException')
        return {}
      })

      const res = await buildApp().request('/providers', post(validCreateBody))

      expect(res.status).toBe(500)
      // Leaving the IdP behind would strand exactly the registered-but-unusable
      // provider this endpoint exists to prevent.
      expect(DeleteIdentityProviderCommand).toHaveBeenCalledWith(
        expect.objectContaining({ ProviderName: 'GoogleOIDC' }),
      )
      expect(mockDb.tenantSsoProvider.delete).toHaveBeenCalledWith({ where: { id: 'provider-1' } })
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

    // UpdateIdentityProvider replaces ProviderDetails wholesale, and the client
    // secret is never persisted here — so syncing Cognito on an edit that did not
    // touch a Cognito-stored field would drop client_secret and silently break
    // login. Name and isEnabled live only in the DB; they must not reach Cognito.
    it('does not call Cognito when only the display name changed', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockExistingRow)
      mockDb.tenantSsoProvider.update.mockResolvedValue(mockProviderRow)

      const res = await buildApp().request('/providers/provider-1', put({ name: 'Renamed' }))

      expect(res.status).toBe(200)
      expect(UpdateIdentityProviderCommand).not.toHaveBeenCalled()
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('does not call Cognito when only isEnabled changed', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockExistingRow)
      mockDb.tenantSsoProvider.update.mockResolvedValue(mockProviderRow)

      const res = await buildApp().request('/providers/provider-1', put({ isEnabled: false }))

      expect(res.status).toBe(200)
      expect(UpdateIdentityProviderCommand).not.toHaveBeenCalled()
    })

    // The API never stores the secret, so it cannot re-send one it was not given.
    // Rather than resync without it (wiping it), demand it up front.
    it('returns 400 when an OIDC Cognito-relevant field changes without a client secret', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockExistingRow)

      const res = await buildApp().request(
        '/providers/provider-1',
        put({ metadataUrl: 'https://idp.example.com/.well-known/openid-configuration' }),
      )

      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
      // Reject before touching the DB, so the row cannot drift from Cognito.
      expect(mockDb.tenantSsoProvider.update).not.toHaveBeenCalled()
      expect(UpdateIdentityProviderCommand).not.toHaveBeenCalled()
    })

    it('syncs Cognito with client_secret when an OIDC field changes and a secret is supplied', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockExistingRow)
      mockDb.tenantSsoProvider.update.mockResolvedValue(mockProviderRow)

      const res = await buildApp().request(
        '/providers/provider-1',
        put({ oidcClientId: 'new-client-id', oidcClientSecret: 'new-secret' }),
      )

      expect(res.status).toBe(200)
      expect(UpdateIdentityProviderCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          UserPoolId: expect.any(String),
          ProviderName: 'GoogleOIDC',
          ProviderDetails: expect.objectContaining({
            client_id: 'new-client-id',
            client_secret: 'new-secret',
            authorize_scopes: 'openid email profile',
          }),
        }),
      )
    })

    // SAML has no client secret, so a metadata change needs no extra credential.
    it('syncs a SAML metadata change to Cognito without requiring a secret', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue({
        ...mockExistingRow,
        type: 'SAML' as const,
        metadataUrl: 'https://okta.example.com/metadata',
        oidcClientId: null,
      })
      mockDb.tenantSsoProvider.update.mockResolvedValue(mockSamlProviderRow)

      const res = await buildApp().request(
        '/providers/provider-1',
        put({ metadataUrl: 'https://okta.example.com/metadata-v2' }),
      )

      expect(res.status).toBe(200)
      expect(UpdateIdentityProviderCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ProviderDetails: { MetadataURL: 'https://okta.example.com/metadata-v2' },
        }),
      )
    })

    it('returns 500 and does not retry when Cognito UpdateIdentityProvider fails', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockExistingRow)
      mockDb.tenantSsoProvider.update.mockResolvedValue(mockProviderRow)
      mockSend.mockRejectedValue(new Error('Cognito error'))

      const res = await buildApp().request(
        '/providers/provider-1',
        put({ oidcClientId: 'x', oidcClientSecret: 'new-secret' }),
      )
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

    it('revokes the provider on the app client before deleting the IdP', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockDeleteRow)
      mockDb.tenantSsoProvider.delete.mockResolvedValue(undefined)
      mockSend.mockImplementation(async (cmd: { __cmd?: string }) => {
        if (cmd?.__cmd === 'DescribeUserPoolClient') {
          return {
            UserPoolClient: {
              ...mockAppClient,
              SupportedIdentityProviders: ['COGNITO', 'GoogleOIDC'],
            },
          }
        }
        return {}
      })

      const res = await buildApp().request('/providers/provider-1', { method: 'DELETE' })

      expect(res.status).toBe(204)
      expect(appClientWrites()).toEqual([['COGNITO']])

      // Order matters: Cognito validates SupportedIdentityProviders on every client
      // update, so deleting the IdP first would leave the client naming a provider that
      // no longer exists — poisoning every later update to it.
      const order = mockSend.mock.calls.map((c) => (c[0] as { __cmd?: string }).__cmd ?? 'idp')
      expect(order.indexOf('UpdateUserPoolClient')).toBeLessThan(order.lastIndexOf('idp'))
    })

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

    // The exception describes the *IdP* being gone, so only the IdP call rejects —
    // the app-client calls still work, and revoking a stale name is precisely the
    // repair this state wants.
    it('treats ResourceNotFoundException from Cognito as idempotent and still deletes DB record', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockDeleteRow)
      mockDb.tenantSsoProvider.delete.mockResolvedValue(undefined)
      const err = Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' })
      mockSend.mockImplementation(async (cmd: { __cmd?: string }) => {
        if (cmd?.__cmd === 'DescribeUserPoolClient') return { UserPoolClient: { ...mockAppClient } }
        if (cmd?.__cmd === 'UpdateUserPoolClient') return {}
        throw err
      })

      const res = await buildApp().request('/providers/provider-1', { method: 'DELETE' })
      expect(res.status).toBe(204)
      expect(mockDb.tenantSsoProvider.delete).toHaveBeenCalledWith({ where: { id: 'provider-1' } })
    })

    // Revoking on the client is NOT idempotent-on-failure: if we deleted the IdP anyway,
    // the client would be left naming a provider that no longer exists, and Cognito
    // validates that list on every update — poisoning every later write to the client.
    it('returns 500 and does not delete the IdP when the app client revoke fails', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockDeleteRow)
      mockSend.mockImplementation(async (cmd: { __cmd?: string }) => {
        if (cmd?.__cmd === 'DescribeUserPoolClient') {
          return {
            UserPoolClient: {
              ...mockAppClient,
              SupportedIdentityProviders: ['COGNITO', 'GoogleOIDC'],
            },
          }
        }
        if (cmd?.__cmd === 'UpdateUserPoolClient') throw new Error('AccessDeniedException')
        return {}
      })

      const res = await buildApp().request('/providers/provider-1', { method: 'DELETE' })

      expect(res.status).toBe(500)
      expect(DeleteIdentityProviderCommand).not.toHaveBeenCalled()
      expect(mockDb.tenantSsoProvider.delete).not.toHaveBeenCalled()
    })

    it('treats NotAuthorizedException from Cognito as idempotent and still deletes DB record', async () => {
      mockDb.tenantSsoProvider.findUnique.mockResolvedValue(mockDeleteRow)
      mockDb.tenantSsoProvider.delete.mockResolvedValue(undefined)
      const err = Object.assign(new Error('not authorized'), { name: 'NotAuthorizedException' })
      mockSend.mockImplementation(async (cmd: { __cmd?: string }) => {
        if (cmd?.__cmd === 'DescribeUserPoolClient') return { UserPoolClient: { ...mockAppClient } }
        if (cmd?.__cmd === 'UpdateUserPoolClient') return {}
        throw err
      })

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
