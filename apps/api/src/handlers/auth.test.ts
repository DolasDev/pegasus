// ---------------------------------------------------------------------------
// Unit tests for the auth handler — new multi-tenant endpoints
//
// Tests POST /api/auth/resolve-tenants and POST /api/auth/select-tenant.
//
// The db module is mocked via vi.hoisted() so mock fns are available before
// the module factory runs. authHandler imports `db` from '../db' (singleton),
// so vi.mock('../db') intercepts it before authHandler is imported.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { authHandler } from './auth'

// ---------------------------------------------------------------------------
// db mock
// ---------------------------------------------------------------------------

const {
  mockTenantFindFirst,
  mockTenantFindUnique,
  mockTenantUserFindMany,
  mockTenantUserFindFirst,
  mockTenantUserFindUnique,
  mockAuthSessionCreate,
  mockSsoProviderFindFirst,
} = vi.hoisted(() => ({
  mockTenantFindFirst: vi.fn(),
  mockTenantFindUnique: vi.fn(),
  mockTenantUserFindMany: vi.fn(),
  mockTenantUserFindFirst: vi.fn(),
  mockTenantUserFindUnique: vi.fn(),
  mockAuthSessionCreate: vi.fn(),
  mockSsoProviderFindFirst: vi.fn(),
}))

vi.mock('../db', () => ({
  db: {
    tenant: {
      findFirst: mockTenantFindFirst,
      findUnique: mockTenantFindUnique,
    },
    tenantUser: {
      findMany: mockTenantUserFindMany,
      findFirst: mockTenantUserFindFirst,
      findUnique: mockTenantUserFindUnique,
    },
    authSession: { create: mockAuthSessionCreate },
    tenantSsoProvider: { findFirst: mockSsoProviderFindFirst },
  },
}))

// ---------------------------------------------------------------------------
// jose mock — intercept jwtVerify before authHandler import resolves
// ---------------------------------------------------------------------------

const { mockJwtVerify } = vi.hoisted(() => ({
  mockJwtVerify: vi.fn(),
}))

vi.mock('jose', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('jose')>()
  return {
    ...actual,
    createRemoteJWKSet: vi.fn().mockReturnValue('mock-jwks'),
    jwtVerify: mockJwtVerify,
  }
})

// ---------------------------------------------------------------------------
// Test helpers
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

/** A minimal TenantUser row joined to a Tenant with ssoProviders. */
function makeTenantUserWithTenant(overrides?: {
  tenantId?: string
  tenantName?: string
  cognitoAuthEnabled?: boolean
  ssoProviders?: unknown[]
  status?: string
}) {
  return {
    status: overrides?.status ?? 'ACTIVE',
    tenant: {
      id: overrides?.tenantId ?? 'tenant-uuid-1',
      name: overrides?.tenantName ?? 'Acme Corp',
      cognitoAuthEnabled: overrides?.cognitoAuthEnabled ?? true,
      ssoProviders: overrides?.ssoProviders ?? [],
    },
  }
}

function makeTenantRow(overrides?: {
  id?: string
  name?: string
  cognitoAuthEnabled?: boolean
  ssoProviders?: unknown[]
}) {
  return {
    id: overrides?.id ?? 'tenant-uuid-1',
    name: overrides?.name ?? 'Acme Corp',
    cognitoAuthEnabled: overrides?.cognitoAuthEnabled ?? true,
    ssoProviders: overrides?.ssoProviders ?? [],
  }
}

// ---------------------------------------------------------------------------
// POST /api/auth/resolve-tenants
// ---------------------------------------------------------------------------

describe('POST /api/auth/resolve-tenants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with an array of tenants when TenantUser records exist', async () => {
    mockTenantUserFindMany.mockResolvedValue([
      makeTenantUserWithTenant({ tenantId: 'tenant-1', tenantName: 'Acme' }),
      makeTenantUserWithTenant({ tenantId: 'tenant-2', tenantName: 'Beta Inc' }),
    ])

    const res = await authHandler.request('/resolve-tenants', post({ email: 'user@company.com' }))
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body.data as JsonBody[]
    expect(data).toHaveLength(2)
    expect(data[0]!['tenantId']).toBe('tenant-1')
    expect(data[1]!['tenantId']).toBe('tenant-2')
  })

  it('returns tenantName, cognitoAuthEnabled, and providers in each item', async () => {
    mockTenantUserFindMany.mockResolvedValue([
      makeTenantUserWithTenant({
        tenantName: 'Acme Corp',
        cognitoAuthEnabled: false,
        ssoProviders: [{ cognitoProviderName: 'AcmeOkta', name: 'Acme Okta', type: 'OIDC' }],
      }),
    ])

    const res = await authHandler.request('/resolve-tenants', post({ email: 'user@acme.com' }))
    expect(res.status).toBe(200)
    const item = ((await json(res)).data as JsonBody[])[0] as JsonBody
    expect(item['tenantName']).toBe('Acme Corp')
    expect(item['cognitoAuthEnabled']).toBe(false)
    expect(item['providers']).toEqual([{ id: 'AcmeOkta', name: 'Acme Okta', type: 'oidc' }])
  })

  it('lowercases the provider type in the response', async () => {
    mockTenantUserFindMany.mockResolvedValue([
      makeTenantUserWithTenant({
        ssoProviders: [{ cognitoProviderName: 'OktaSAML', name: 'Okta', type: 'SAML' }],
      }),
    ])

    const res = await authHandler.request('/resolve-tenants', post({ email: 'user@acme.com' }))
    const item = ((await json(res)).data as JsonBody[])[0] as JsonBody
    const providers = item['providers'] as JsonBody[]
    expect(providers[0]!['type']).toBe('saml')
  })

  it('queries TenantUser with status not DEACTIVATED and tenant status ACTIVE', async () => {
    mockTenantUserFindMany.mockResolvedValue([])

    await authHandler.request('/resolve-tenants', post({ email: 'user@acme.com' }))

    expect(mockTenantUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: { equals: 'user@acme.com', mode: 'insensitive' },
          status: { not: 'DEACTIVATED' },
          tenant: { status: 'ACTIVE' },
        }),
      }),
    )
  })

  it('returns 200 with an empty array when the email has no roster rows', async () => {
    mockTenantUserFindMany.mockResolvedValue([])

    const res = await authHandler.request('/resolve-tenants', post({ email: 'user@unknown.com' }))
    expect(res.status).toBe(200)
    const data = (await json(res)).data as JsonBody[]
    expect(data).toHaveLength(0)
  })

  it('returns 400 VALIDATION_ERROR when email is missing', async () => {
    const res = await authHandler.request('/resolve-tenants', post({}))
    expect(res.status).toBe(400)
    expect((await json(res)).code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 VALIDATION_ERROR when email is not a valid email address', async () => {
    const res = await authHandler.request('/resolve-tenants', post({ email: 'notanemail' }))
    expect(res.status).toBe(400)
    expect((await json(res)).code).toBe('VALIDATION_ERROR')
  })

  it('returns 500 on DB error', async () => {
    mockTenantUserFindMany.mockRejectedValue(new Error('DB connection failed'))

    const res = await authHandler.request('/resolve-tenants', post({ email: 'user@acme.com' }))
    expect(res.status).toBe(500)
    expect((await json(res)).code).toBe('INTERNAL_ERROR')
  })
})

// ---------------------------------------------------------------------------
// POST /api/auth/select-tenant
// ---------------------------------------------------------------------------

describe('POST /api/auth/select-tenant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with TenantResolution on success', async () => {
    mockTenantUserFindFirst.mockResolvedValue({ status: 'ACTIVE' })
    mockTenantFindFirst.mockResolvedValue(
      makeTenantRow({ id: 'tenant-1', name: 'Acme Corp', cognitoAuthEnabled: true }),
    )
    mockAuthSessionCreate.mockResolvedValue({})

    const res = await authHandler.request(
      '/select-tenant',
      post({ email: 'user@acme.com', tenantId: 'tenant-1' }),
    )
    expect(res.status).toBe(200)
    const data = (await json(res)).data as JsonBody
    expect(data['tenantId']).toBe('tenant-1')
    expect(data['tenantName']).toBe('Acme Corp')
    expect(data['cognitoAuthEnabled']).toBe(true)
  })

  it('creates an AuthSession with 10-minute expiry', async () => {
    const before = Date.now()
    mockTenantUserFindFirst.mockResolvedValue({ status: 'ACTIVE' })
    mockTenantFindFirst.mockResolvedValue(makeTenantRow())
    mockAuthSessionCreate.mockResolvedValue({})

    await authHandler.request(
      '/select-tenant',
      post({ email: 'user@acme.com', tenantId: 'tenant-1' }),
    )
    const after = Date.now()

    expect(mockAuthSessionCreate).toHaveBeenCalledOnce()
    const createCall = mockAuthSessionCreate.mock.calls[0]![0] as {
      data: { email: string; tenantId: string; expiresAt: Date }
    }
    expect(createCall.data.email).toBe('user@acme.com')
    expect(createCall.data.tenantId).toBe('tenant-1')
    const expiresAt = createCall.data.expiresAt.getTime()
    expect(expiresAt).toBeGreaterThanOrEqual(before + 10 * 60 * 1000 - 100)
    expect(expiresAt).toBeLessThanOrEqual(after + 10 * 60 * 1000 + 100)
  })

  it('returns 403 FORBIDDEN when TenantUser not found (user not invited)', async () => {
    mockTenantUserFindFirst.mockResolvedValue(null)

    const res = await authHandler.request(
      '/select-tenant',
      post({ email: 'stranger@acme.com', tenantId: 'tenant-1' }),
    )
    expect(res.status).toBe(403)
    expect((await json(res)).code).toBe('FORBIDDEN')
  })

  it('returns 403 FORBIDDEN when TenantUser is DEACTIVATED', async () => {
    mockTenantUserFindFirst.mockResolvedValue({ status: 'DEACTIVATED' })

    const res = await authHandler.request(
      '/select-tenant',
      post({ email: 'gone@acme.com', tenantId: 'tenant-1' }),
    )
    expect(res.status).toBe(403)
    expect((await json(res)).code).toBe('FORBIDDEN')
  })

  it('returns 404 NOT_FOUND when tenant not found or not ACTIVE', async () => {
    mockTenantUserFindFirst.mockResolvedValue({ status: 'ACTIVE' })
    mockTenantFindFirst.mockResolvedValue(null)

    const res = await authHandler.request(
      '/select-tenant',
      post({ email: 'user@acme.com', tenantId: 'suspended-tenant' }),
    )
    expect(res.status).toBe(404)
    expect((await json(res)).code).toBe('NOT_FOUND')
  })

  it('does not create AuthSession when validation fails', async () => {
    mockTenantUserFindFirst.mockResolvedValue(null)

    await authHandler.request(
      '/select-tenant',
      post({ email: 'stranger@acme.com', tenantId: 'tenant-1' }),
    )

    expect(mockAuthSessionCreate).not.toHaveBeenCalled()
  })

  it('returns 400 VALIDATION_ERROR when email is missing', async () => {
    const res = await authHandler.request('/select-tenant', post({ tenantId: 'tenant-1' }))
    expect(res.status).toBe(400)
    expect((await json(res)).code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 VALIDATION_ERROR when tenantId is missing', async () => {
    const res = await authHandler.request('/select-tenant', post({ email: 'user@acme.com' }))
    expect(res.status).toBe(400)
    expect((await json(res)).code).toBe('VALIDATION_ERROR')
  })

  it('returns 500 on DB error', async () => {
    mockTenantUserFindFirst.mockRejectedValue(new Error('timeout'))

    const res = await authHandler.request(
      '/select-tenant',
      post({ email: 'user@acme.com', tenantId: 'tenant-1' }),
    )
    expect(res.status).toBe(500)
    expect((await json(res)).code).toBe('INTERNAL_ERROR')
  })

  it('accepts PENDING TenantUser status (invited, not yet logged in)', async () => {
    mockTenantUserFindFirst.mockResolvedValue({ status: 'PENDING' })
    mockTenantFindFirst.mockResolvedValue(makeTenantRow())
    mockAuthSessionCreate.mockResolvedValue({})

    const res = await authHandler.request(
      '/select-tenant',
      post({ email: 'new@acme.com', tenantId: 'tenant-1' }),
    )
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// GET /api/auth/mobile-config (API-01)
// ---------------------------------------------------------------------------

describe('GET /api/auth/mobile-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('COGNITO_USER_POOL_ID', 'us-east-1_TestPool')
    vi.stubEnv('COGNITO_MOBILE_CLIENT_ID', 'test-mobile-client-id')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 400 VALIDATION_ERROR when tenantId query param is missing', async () => {
    const res = await authHandler.request('/mobile-config')
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['code']).toBe('VALIDATION_ERROR')
  })

  it('returns 400 TENANT_NOT_FOUND when tenantId does not match any tenant', async () => {
    mockTenantFindUnique.mockResolvedValue(null)

    const res = await authHandler.request('/mobile-config?tenantId=non-existent-id')
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['error']).toBe('Tenant not found')
    expect(body['code']).toBe('TENANT_NOT_FOUND')
  })

  it('returns 500 INTERNAL_ERROR when COGNITO env vars are not set', async () => {
    vi.unstubAllEnvs()
    mockTenantFindUnique.mockResolvedValue({ id: 'tenant-uuid-1' })

    const res = await authHandler.request('/mobile-config?tenantId=tenant-uuid-1')
    expect(res.status).toBe(500)
    const body = await json(res)
    expect(body['error']).toBe('Authentication service misconfigured')
    expect(body['code']).toBe('INTERNAL_ERROR')
  })

  it('returns 200 with userPoolId and clientId for a valid tenant', async () => {
    mockTenantFindUnique.mockResolvedValue({ id: 'tenant-uuid-1' })

    const res = await authHandler.request('/mobile-config?tenantId=tenant-uuid-1')
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body['data'] as Record<string, unknown>
    expect(data['userPoolId']).toBe('us-east-1_TestPool')
    expect(data['clientId']).toBe('test-mobile-client-id')
  })

  it('returns hostedUiDomain and redirectUri when COGNITO_HOSTED_UI_DOMAIN is set', async () => {
    vi.stubEnv('COGNITO_HOSTED_UI_DOMAIN', 'https://pegasus-test.auth.us-east-1.amazoncognito.com')
    mockTenantFindUnique.mockResolvedValue({ id: 'tenant-uuid-1' })

    const res = await authHandler.request('/mobile-config?tenantId=tenant-uuid-1')
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body['data'] as Record<string, unknown>
    expect(data['hostedUiDomain']).toBe('https://pegasus-test.auth.us-east-1.amazoncognito.com')
    expect(data['redirectUri']).toBe('movingapp://auth/callback')
  })

  it('returns hostedUiDomain as null when COGNITO_HOSTED_UI_DOMAIN is not set', async () => {
    mockTenantFindUnique.mockResolvedValue({ id: 'tenant-uuid-1' })

    const res = await authHandler.request('/mobile-config?tenantId=tenant-uuid-1')
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body['data'] as Record<string, unknown>
    expect(data['hostedUiDomain']).toBeNull()
    expect(data['redirectUri']).toBe('movingapp://auth/callback')
  })
})

// ---------------------------------------------------------------------------
// POST /api/auth/validate-token (AUTH-03)
// ---------------------------------------------------------------------------

describe('POST /api/auth/validate-token', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv(
      'COGNITO_JWKS_URL',
      'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST/.well-known/jwks.json',
    )
    vi.stubEnv('COGNITO_TENANT_CLIENT_ID', 'tenant-client-id')
    vi.stubEnv('COGNITO_MOBILE_CLIENT_ID', 'mobile-client-id')
    mockTenantFindUnique.mockResolvedValue({ name: 'Acme Corp' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // Case 1: Tenant client ID token — full session shape asserted
  it('returns 200 with session claims when tenant client ID token is valid', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: {
        sub: 'user-sub-123',
        email: 'user@acme.com',
        exp: 9999999999,
        token_use: 'id',
        'custom:tenantId': 'tenant-abc',
        'custom:roles': JSON.stringify(['viewer']),
      },
    })

    const res = await authHandler.request('/validate-token', post({ idToken: 'tok' }))
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body['data'] as Record<string, unknown>
    expect(data['sub']).toBe('user-sub-123')
    expect(data['tenantId']).toBe('tenant-abc')
    expect(data['tenantName']).toBe('Acme Corp')
    expect(data['roleNames']).toEqual(['viewer'])
    expect(data['role']).toBe('viewer')
    expect(data['email']).toBe('user@acme.com')
    expect(data['expiresAt']).toBe(9999999999)
    expect(data['ssoProvider']).toBeNull()
  })

  // Case 2: Mobile client ID token — ssoProvider populated from identities claim
  it('returns 200 with ssoProvider populated when mobile token includes identities claim', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: {
        sub: 'user-sub-456',
        email: 'driver@acme.com',
        exp: 9999999999,
        token_use: 'id',
        'custom:tenantId': 'tenant-abc',
        'custom:roles': JSON.stringify(['viewer']),
        identities: [{ providerName: 'acme-okta' }],
      },
    })

    const res = await authHandler.request('/validate-token', post({ idToken: 'tok' }))
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body['data'] as Record<string, unknown>
    expect(data['ssoProvider']).toBe('acme-okta')
  })

  // Case 3: Unknown audience — jose throws generic error (audience mismatch path)
  it('returns 401 UNAUTHORIZED when token audience does not match', async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error('JWT audience mismatch'))

    const res = await authHandler.request('/validate-token', post({ idToken: 'tok' }))
    expect(res.status).toBe(401)
    const body = await json(res)
    expect(body['code']).toBe('UNAUTHORIZED')
  })

  // Case 4: Expired token — jose throws JWTExpired (specific error path)
  it('returns 401 TOKEN_EXPIRED when token is expired', async () => {
    // Use Object.assign to create an error that passes instanceof errors.JWTExpired
    // without needing to satisfy the full JWTClaimValidationFailed constructor signature.
    // The ...actual spread in vi.mock('jose') preserves the real errors export.
    const { errors } = await import('jose')
    const expiredErr = Object.assign(
      new errors.JWTExpired('token expired', {}, 'exp', 'check_failed'),
      {},
    )
    mockJwtVerify.mockRejectedValueOnce(expiredErr)

    const res = await authHandler.request('/validate-token', post({ idToken: 'tok' }))
    expect(res.status).toBe(401)
    const body = await json(res)
    expect(body['code']).toBe('TOKEN_EXPIRED')
  })

  // Case 5: Wrong token_use — access token instead of ID token
  it('returns 401 UNAUTHORIZED when token_use is "access" instead of "id"', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: {
        sub: 'user-sub-123',
        email: 'user@acme.com',
        exp: 9999999999,
        token_use: 'access',
        'custom:tenantId': 'tenant-abc',
        'custom:roles': JSON.stringify(['viewer']),
      },
    })

    const res = await authHandler.request('/validate-token', post({ idToken: 'tok' }))
    expect(res.status).toBe(401)
    const body = await json(res)
    expect(body['code']).toBe('UNAUTHORIZED')
  })

  // Case 6: Missing sub or email — cannot build a session
  it('returns 401 UNAUTHORIZED when sub or email claims are missing', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: {
        // sub deliberately absent
        email: 'user@acme.com',
        exp: 9999999999,
        token_use: 'id',
        'custom:tenantId': 'tenant-abc',
        'custom:roles': JSON.stringify(['viewer']),
      },
    })

    const res = await authHandler.request('/validate-token', post({ idToken: 'tok' }))
    expect(res.status).toBe(401)
    const body = await json(res)
    expect(body['code']).toBe('UNAUTHORIZED')
  })

  // Case 7: Missing custom:tenantId or custom:roles — pre-token Lambda did not inject claims
  it('returns 403 FORBIDDEN when custom:tenantId or custom:roles claims are missing', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: {
        sub: 'user-sub-123',
        email: 'user@acme.com',
        exp: 9999999999,
        token_use: 'id',
        // custom:tenantId and custom:roles deliberately absent
      },
    })

    const res = await authHandler.request('/validate-token', post({ idToken: 'tok' }))
    expect(res.status).toBe(403)
    const body = await json(res)
    expect(body['code']).toBe('FORBIDDEN')
  })

  // Case 8: Env vars not set — guard fires before jwtVerify is called
  it('returns 500 INTERNAL_ERROR when required env vars are not set', async () => {
    vi.unstubAllEnvs()
    // Do not call mockJwtVerify — the env guard returns before reaching jwtVerify

    const res = await authHandler.request('/validate-token', post({ idToken: 'tok' }))
    expect(res.status).toBe(500)
    const body = await json(res)
    expect(body['code']).toBe('INTERNAL_ERROR')
  })

  // Case 9: Invalid JWT — general catch-all path (distinct from JWTExpired path)
  it('returns 401 UNAUTHORIZED when JWT is invalid or unparseable', async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error('Invalid compact JWS'))

    const res = await authHandler.request('/validate-token', post({ idToken: 'tok' }))
    expect(res.status).toBe(401)
    const body = await json(res)
    expect(body['code']).toBe('UNAUTHORIZED')
  })
})

// ---------------------------------------------------------------------------
// POST /api/auth/idp-sign-out-url
//
// The login page calls this only on an error path, to offer "sign out of your
// IdP and try again". Its contract is therefore unusual: it must NEVER fail the
// caller. Every unhappy branch below is asserted to be a 200 with a null URL,
// because a 500 here would replace a recoverable error screen with a dead end.
//
// Each test uses a DISTINCT metadataUrl: the handler memoizes discovery lookups
// per Lambda container for the process lifetime, so shared URLs would leak
// results between tests. The final test pins that memoization deliberately.
// ---------------------------------------------------------------------------

describe('POST /api/auth/idp-sign-out-url', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** A discovery document response carrying the given end_session_endpoint. */
  function discoveryDoc(endSessionEndpoint?: string) {
    return {
      ok: true,
      status: 200,
      json: async () => (endSessionEndpoint ? { end_session_endpoint: endSessionEndpoint } : {}),
    }
  }

  function oidcProvider(metadataUrl: string) {
    return { type: 'OIDC', metadataUrl }
  }

  it('returns the end_session_endpoint from the provider discovery document', async () => {
    mockSsoProviderFindFirst.mockResolvedValue(
      oidcProvider('https://idp.test/a/.well-known/openid-configuration'),
    )
    fetchMock.mockResolvedValue(discoveryDoc('https://idp.test/a/logout'))

    const res = await authHandler.request(
      '/idp-sign-out-url',
      post({ tenantId: 't1', providerId: 'AcmeOkta' }),
    )

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ data: { signOutUrl: 'https://idp.test/a/logout' } })
  })

  it('scopes the provider lookup to the tenant and requires it to be enabled', async () => {
    mockSsoProviderFindFirst.mockResolvedValue(null)

    await authHandler.request('/idp-sign-out-url', post({ tenantId: 't1', providerId: 'AcmeOkta' }))

    expect(mockSsoProviderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't1', cognitoProviderName: 'AcmeOkta', isEnabled: true },
      }),
    )
  })

  it('returns null for an unknown or disabled provider', async () => {
    mockSsoProviderFindFirst.mockResolvedValue(null)

    const res = await authHandler.request(
      '/idp-sign-out-url',
      post({ tenantId: 't1', providerId: 'Nope' }),
    )

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ data: { signOutUrl: null } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null for a SAML provider without attempting discovery', async () => {
    mockSsoProviderFindFirst.mockResolvedValue({
      type: 'SAML',
      metadataUrl: 'https://idp.test/saml/metadata',
    })

    const res = await authHandler.request(
      '/idp-sign-out-url',
      post({ tenantId: 't1', providerId: 'AcmeSaml' }),
    )

    expect(await json(res)).toEqual({ data: { signOutUrl: null } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null when the IdP publishes no end_session_endpoint', async () => {
    mockSsoProviderFindFirst.mockResolvedValue(
      oidcProvider('https://idp.test/b/.well-known/openid-configuration'),
    )
    fetchMock.mockResolvedValue(discoveryDoc())

    const res = await authHandler.request(
      '/idp-sign-out-url',
      post({ tenantId: 't1', providerId: 'AcmeOkta' }),
    )

    expect(await json(res)).toEqual({ data: { signOutUrl: null } })
  })

  it('returns null — not a 500 — when the discovery document is unreachable', async () => {
    mockSsoProviderFindFirst.mockResolvedValue(
      oidcProvider('https://idp.test/c/.well-known/openid-configuration'),
    )
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'))

    const res = await authHandler.request(
      '/idp-sign-out-url',
      post({ tenantId: 't1', providerId: 'AcmeOkta' }),
    )

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ data: { signOutUrl: null } })
  })

  it('returns null when the discovery fetch responds non-OK', async () => {
    mockSsoProviderFindFirst.mockResolvedValue(
      oidcProvider('https://idp.test/d/.well-known/openid-configuration'),
    )
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })

    const res = await authHandler.request(
      '/idp-sign-out-url',
      post({ tenantId: 't1', providerId: 'AcmeOkta' }),
    )

    expect(await json(res)).toEqual({ data: { signOutUrl: null } })
  })

  it('drops a non-https end_session_endpoint — the client turns this into a navigation', async () => {
    mockSsoProviderFindFirst.mockResolvedValue(
      oidcProvider('https://idp.test/e/.well-known/openid-configuration'),
    )
    fetchMock.mockResolvedValue(discoveryDoc('javascript:alert(1)'))

    const res = await authHandler.request(
      '/idp-sign-out-url',
      post({ tenantId: 't1', providerId: 'AcmeOkta' }),
    )

    expect(await json(res)).toEqual({ data: { signOutUrl: null } })
  })

  it('returns null — not a 500 — when the provider lookup itself throws', async () => {
    mockSsoProviderFindFirst.mockRejectedValue(new Error('connection refused'))

    const res = await authHandler.request(
      '/idp-sign-out-url',
      post({ tenantId: 't1', providerId: 'AcmeOkta' }),
    )

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ data: { signOutUrl: null } })
  })

  it('returns 400 VALIDATION_ERROR on a malformed body', async () => {
    const res = await authHandler.request('/idp-sign-out-url', post({ tenantId: 't1' }))

    expect(res.status).toBe(400)
    expect((await json(res))['code']).toBe('VALIDATION_ERROR')
  })

  it('memoizes the discovery lookup across requests', async () => {
    mockSsoProviderFindFirst.mockResolvedValue(
      oidcProvider('https://idp.test/cached/.well-known/openid-configuration'),
    )
    fetchMock.mockResolvedValue(discoveryDoc('https://idp.test/cached/logout'))

    const body = post({ tenantId: 't1', providerId: 'AcmeOkta' })
    await authHandler.request('/idp-sign-out-url', body)
    const res = await authHandler.request(
      '/idp-sign-out-url',
      post({ tenantId: 't1', providerId: 'AcmeOkta' }),
    )

    expect(await json(res)).toEqual({
      data: { signOutUrl: 'https://idp.test/cached/logout' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
