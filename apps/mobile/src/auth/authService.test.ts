import { createAuthService, isRefreshRejected } from './authService'
import { AuthError, type CognitoTokens, type Session, type TenantResolution } from './types'
import type { MobileConfig } from '../config'
import type { OAuthConfig } from './oauthService'

const mockConfig: MobileConfig = {
  apiUrl: 'http://api.test',
  cognito: {
    region: 'us-east-1',
    userPoolId: 'us-east-1_ABC',
    clientId: 'client123',
    domain: 'https://pegasus-test.auth.us-east-1.amazoncognito.com',
    redirectUri: 'movingapp://auth/callback',
  },
}

const mockApiSession: Omit<Session, 'token'> = {
  sub: 'sub-1',
  tenantId: 'tenant-1',
  tenantName: 'Tenant One',
  roleNames: ['driver'],
  role: 'driver',
  email: 'a@b.com',
  expiresAt: 9999999999,
  ssoProvider: null,
}

const mockTenants: TenantResolution[] = [
  {
    tenantId: 'tenant-acme',
    tenantName: 'Acme Moving Co',
    cognitoAuthEnabled: true,
    providers: [],
  },
  {
    tenantId: 'tenant-best',
    tenantName: 'Best Movers',
    cognitoAuthEnabled: true,
    providers: [{ id: 'GoogleSSO', name: 'Google', type: 'oidc' as const }],
  },
]

const mockCognitoService = {
  signIn: jest.fn<Promise<CognitoTokens>, [string, string, string, string]>(),
  refresh: jest.fn<Promise<CognitoTokens>, [string, string, string]>(),
  revoke: jest.fn<Promise<void>, [string, string, string]>(),
}

const mockOAuthService = {
  authorize: jest.fn<Promise<CognitoTokens>, [OAuthConfig, string]>(),
  refresh: jest.fn<Promise<CognitoTokens>, [OAuthConfig, string]>(),
}

beforeEach(() => {
  global.fetch = jest.fn()
  mockCognitoService.signIn.mockReset()
  mockCognitoService.refresh.mockReset()
  mockCognitoService.revoke.mockReset()
  mockOAuthService.authorize.mockReset()
  mockOAuthService.refresh.mockReset()
})

describe('createAuthService', () => {
  describe('authenticate', () => {
    it('calls signIn with baked config then validate-token, and returns Session with token', async () => {
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: mockApiSession }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      )
      mockCognitoService.signIn.mockResolvedValue({ idToken: 'raw-id-token' })

      const { authenticate } = createAuthService({
        config: mockConfig,
        cognitoService: mockCognitoService,
        oauthService: mockOAuthService,
      })
      const result = await authenticate('a@b.com', 'pass', 'tenant-1')

      expect(mockCognitoService.signIn).toHaveBeenCalledWith(
        'a@b.com',
        'pass',
        'us-east-1_ABC',
        'client123',
      )
      expect(result).toEqual({
        session: { ...mockApiSession, token: 'raw-id-token' },
        refresh: null,
      })
    })

    it('makes exactly 1 fetch call (validate-token only — no config fetch)', async () => {
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: mockApiSession }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      )
      mockCognitoService.signIn.mockResolvedValue({ idToken: 'raw-id-token' })

      const { authenticate } = createAuthService({
        config: mockConfig,
        cognitoService: mockCognitoService,
        oauthService: mockOAuthService,
      })
      await authenticate('a@b.com', 'pass', 'tenant-1')

      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('passes idToken from signIn to validate-token body', async () => {
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: mockApiSession }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      )
      mockCognitoService.signIn.mockResolvedValue({ idToken: 'raw-id-token' })

      const { authenticate } = createAuthService({
        config: mockConfig,
        cognitoService: mockCognitoService,
        oauthService: mockOAuthService,
      })
      await authenticate('a@b.com', 'pass', 'tenant-1')

      const validateCall = (global.fetch as jest.Mock).mock.calls[0]
      expect(validateCall[0]).toBe(`${mockConfig.apiUrl}/api/auth/validate-token`)
      const body = JSON.parse(validateCall[1].body as string) as { idToken: string }
      expect(body.idToken).toBe('raw-id-token')
    })

    it('rejects with AuthError(ValidateTokenFailed) when validate-token returns non-2xx', async () => {
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(new Response('Unauthorized', { status: 401 })),
      )
      mockCognitoService.signIn.mockResolvedValue({ idToken: 'raw-id-token' })

      const { authenticate } = createAuthService({
        config: mockConfig,
        cognitoService: mockCognitoService,
        oauthService: mockOAuthService,
      })

      await expect(authenticate('a@b.com', 'pass', 'tenant-1')).rejects.toThrow(AuthError)
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(new Response('Unauthorized', { status: 401 })),
      )
      mockCognitoService.signIn.mockResolvedValue({ idToken: 'raw-id-token' })

      try {
        await authenticate('a@b.com', 'pass', 'tenant-1')
      } catch (err) {
        expect((err as AuthError).code).toBe('ValidateTokenFailed')
      }
    })
  })

  describe('resolveTenants', () => {
    it('calls POST /api/auth/resolve-tenants with email body and returns TenantResolution[]', async () => {
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: mockTenants }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      )

      const { resolveTenants } = createAuthService({
        config: mockConfig,
        cognitoService: mockCognitoService,
        oauthService: mockOAuthService,
      })
      const result = await resolveTenants('a@b.com')

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockConfig.apiUrl}/api/auth/resolve-tenants`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'a@b.com' }),
        }),
      )
      expect(result).toEqual(mockTenants)
    })

    it('returns [] when API responds 200 with empty array (does not throw)', async () => {
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      )

      const { resolveTenants } = createAuthService({
        config: mockConfig,
        cognitoService: mockCognitoService,
        oauthService: mockOAuthService,
      })
      const result = await resolveTenants('unknown@b.com')

      expect(result).toEqual([])
    })

    it('throws AuthError(ResolveTenantsFailed) on non-2xx response', async () => {
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(new Response('Bad Request', { status: 400 })),
      )

      const { resolveTenants } = createAuthService({
        config: mockConfig,
        cognitoService: mockCognitoService,
        oauthService: mockOAuthService,
      })

      await expect(resolveTenants('a@b.com')).rejects.toThrow(AuthError)
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(new Response('Bad Request', { status: 400 })),
      )
      try {
        await resolveTenants('a@b.com')
      } catch (err) {
        expect((err as AuthError).code).toBe('ResolveTenantsFailed')
      }
    })

    it('carries the HTTP status on the thrown AuthError', async () => {
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(new Response('Internal server error', { status: 500 })),
      )

      const { resolveTenants } = createAuthService({
        config: mockConfig,
        cognitoService: mockCognitoService,
        oauthService: mockOAuthService,
      })

      try {
        await resolveTenants('a@b.com')
        throw new Error('expected resolveTenants to throw')
      } catch (err) {
        expect((err as AuthError).status).toBe(500)
      }
    })
  })

  describe('selectTenant', () => {
    it('calls POST /api/auth/select-tenant with email and tenantId body and resolves void', async () => {
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(new Response('{}', { status: 200 })),
      )

      const { selectTenant } = createAuthService({
        config: mockConfig,
        cognitoService: mockCognitoService,
        oauthService: mockOAuthService,
      })
      const result = await selectTenant('a@b.com', 'tenant-acme')

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockConfig.apiUrl}/api/auth/select-tenant`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'a@b.com', tenantId: 'tenant-acme' }),
        }),
      )
      expect(result).toBeUndefined()
    })

    it('throws AuthError(SelectTenantFailed) on 403', async () => {
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(new Response('Forbidden', { status: 403 })),
      )

      const { selectTenant } = createAuthService({
        config: mockConfig,
        cognitoService: mockCognitoService,
        oauthService: mockOAuthService,
      })

      await expect(selectTenant('a@b.com', 'bad-id')).rejects.toThrow(AuthError)
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(new Response('Forbidden', { status: 403 })),
      )
      try {
        await selectTenant('a@b.com', 'bad-id')
      } catch (err) {
        expect((err as AuthError).code).toBe('SelectTenantFailed')
      }
    })

    it('throws AuthError(SelectTenantFailed) on 404', async () => {
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(new Response('Not Found', { status: 404 })),
      )

      const { selectTenant } = createAuthService({
        config: mockConfig,
        cognitoService: mockCognitoService,
        oauthService: mockOAuthService,
      })

      await expect(selectTenant('a@b.com', 'bad-id')).rejects.toThrow(AuthError)
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(new Response('Not Found', { status: 404 })),
      )
      try {
        await selectTenant('a@b.com', 'bad-id')
      } catch (err) {
        expect((err as AuthError).code).toBe('SelectTenantFailed')
      }
    })
  })

  describe('authenticateWithSso', () => {
    it('calls oauthService.authorize with baked config then validate-token, and returns Session', async () => {
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: mockApiSession }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      )
      mockOAuthService.authorize.mockResolvedValue({ idToken: 'sso-id-token' })

      const { authenticateWithSso } = createAuthService({
        config: mockConfig,
        cognitoService: mockCognitoService,
        oauthService: mockOAuthService,
      })
      const result = await authenticateWithSso('tenant-1', 'GoogleSSO')

      expect(mockOAuthService.authorize).toHaveBeenCalledWith(
        {
          hostedUiDomain: mockConfig.cognito.domain,
          clientId: mockConfig.cognito.clientId,
          redirectUri: mockConfig.cognito.redirectUri,
        },
        'GoogleSSO',
      )
      expect(result).toEqual({
        session: { ...mockApiSession, token: 'sso-id-token' },
        refresh: null,
      })
    })

    it('makes exactly 1 fetch call (validate-token only — no config fetch)', async () => {
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: mockApiSession }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      )
      mockOAuthService.authorize.mockResolvedValue({ idToken: 'sso-id-token' })

      const { authenticateWithSso } = createAuthService({
        config: mockConfig,
        cognitoService: mockCognitoService,
        oauthService: mockOAuthService,
      })
      await authenticateWithSso('tenant-1', 'GoogleSSO')

      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('passes idToken from oauthService to validate-token body', async () => {
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: mockApiSession }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      )
      mockOAuthService.authorize.mockResolvedValue({ idToken: 'sso-id-token' })

      const { authenticateWithSso } = createAuthService({
        config: mockConfig,
        cognitoService: mockCognitoService,
        oauthService: mockOAuthService,
      })
      await authenticateWithSso('tenant-1', 'GoogleSSO')

      const validateCall = (global.fetch as jest.Mock).mock.calls[0]
      expect(validateCall[0]).toBe(`${mockConfig.apiUrl}/api/auth/validate-token`)
      const body = JSON.parse(validateCall[1].body as string) as { idToken: string }
      expect(body.idToken).toBe('sso-id-token')
    })

    it('throws AuthError(SsoNotConfigured) when domain is null', async () => {
      const configNoSso: MobileConfig = {
        ...mockConfig,
        cognito: { ...mockConfig.cognito, domain: null },
      }

      const { authenticateWithSso } = createAuthService({
        config: configNoSso,
        cognitoService: mockCognitoService,
        oauthService: mockOAuthService,
      })

      await expect(authenticateWithSso('tenant-1', 'GoogleSSO')).rejects.toThrow(AuthError)
      try {
        await authenticateWithSso('tenant-1', 'GoogleSSO')
      } catch (err) {
        expect((err as AuthError).code).toBe('SsoNotConfigured')
      }
    })

    it('rejects with AuthError(ValidateTokenFailed) when validate-token returns non-2xx', async () => {
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(new Response('Unauthorized', { status: 401 })),
      )
      mockOAuthService.authorize.mockResolvedValue({ idToken: 'sso-id-token' })

      const { authenticateWithSso } = createAuthService({
        config: mockConfig,
        cognitoService: mockCognitoService,
        oauthService: mockOAuthService,
      })

      await expect(authenticateWithSso('tenant-1', 'GoogleSSO')).rejects.toThrow(AuthError)
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(new Response('Unauthorized', { status: 401 })),
      )
      mockOAuthService.authorize.mockResolvedValue({ idToken: 'sso-id-token' })

      try {
        await authenticateWithSso('tenant-1', 'GoogleSSO')
      } catch (err) {
        expect((err as AuthError).code).toBe('ValidateTokenFailed')
      }
    })

    it('propagates AuthError from oauthService.authorize', async () => {
      mockOAuthService.authorize.mockRejectedValue(
        new AuthError('UserCancelled', 'SSO login was cancelled'),
      )

      const { authenticateWithSso } = createAuthService({
        config: mockConfig,
        cognitoService: mockCognitoService,
        oauthService: mockOAuthService,
      })

      await expect(authenticateWithSso('tenant-1', 'GoogleSSO')).rejects.toThrow(AuthError)
      mockOAuthService.authorize.mockRejectedValue(
        new AuthError('UserCancelled', 'SSO login was cancelled'),
      )

      try {
        await authenticateWithSso('tenant-1', 'GoogleSSO')
      } catch (err) {
        expect((err as AuthError).code).toBe('UserCancelled')
      }
    })
  })
})

// ---------------------------------------------------------------------------
// Session refresh
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function service() {
  return createAuthService({
    config: mockConfig,
    cognitoService: mockCognitoService,
    oauthService: mockOAuthService,
  })
}

/** fetch stub answering select-tenant 200 then validate-token with the session. */
function stubSelectThenValidate(): jest.Mock {
  const fetchMock = global.fetch as jest.Mock
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ data: { ok: true } }))
    .mockResolvedValueOnce(jsonResponse({ data: mockApiSession }))
  return fetchMock
}

const currentSession: Session = { ...mockApiSession, token: 'old-id-token' }

describe('sign-in keeps the refresh token', () => {
  it('authenticate returns a password-kind refresh token', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse({ data: mockApiSession }))
    mockCognitoService.signIn.mockResolvedValue({ idToken: 'id', refreshToken: 'rt-pw' })
    const result = await service().authenticate('a@b.com', 'pass', 'tenant-1')
    expect(result.refresh).toEqual({ refreshToken: 'rt-pw', kind: 'password' })
    // never inside the session blob
    expect(JSON.stringify(result.session)).not.toContain('rt-pw')
  })

  it('authenticateWithSso returns an sso-kind refresh token', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse({ data: mockApiSession }))
    mockOAuthService.authorize.mockResolvedValue({ idToken: 'id', refreshToken: 'rt-sso' })
    const result = await service().authenticateWithSso('tenant-1', 'GoogleSSO')
    expect(result.refresh).toEqual({ refreshToken: 'rt-sso', kind: 'sso' })
  })
})

describe('refreshSession', () => {
  it('password kind: select-tenant FIRST, then REFRESH_TOKEN_AUTH, then validate-token', async () => {
    const fetchMock = stubSelectThenValidate()
    mockCognitoService.refresh.mockResolvedValue({ idToken: 'new-id-token' })

    const result = await service().refreshSession(currentSession, {
      refreshToken: 'rt-pw',
      kind: 'password',
    })

    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/api/auth/select-tenant')
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      email: 'a@b.com',
      tenantId: 'tenant-1',
    })
    expect(mockCognitoService.refresh).toHaveBeenCalledWith('rt-pw', 'us-east-1_ABC', 'client123')
    expect(fetchMock.mock.calls[1]![0]).toBe('http://api.test/api/auth/validate-token')
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ idToken: 'new-id-token' })
    // select-tenant ran before the Cognito refresh
    expect(fetchMock.mock.invocationCallOrder[0]!).toBeLessThan(
      mockCognitoService.refresh.mock.invocationCallOrder[0]!,
    )
    expect(mockOAuthService.refresh).not.toHaveBeenCalled()
    expect(result.session).toEqual({ ...mockApiSession, token: 'new-id-token' })
    // no rotation → keep the same refresh token
    expect(result.refresh).toEqual({ refreshToken: 'rt-pw', kind: 'password' })
  })

  it('sso kind refreshes through the Hosted UI token endpoint', async () => {
    stubSelectThenValidate()
    mockOAuthService.refresh.mockResolvedValue({ idToken: 'new-id-token' })

    await service().refreshSession(currentSession, { refreshToken: 'rt-sso', kind: 'sso' })

    expect(mockOAuthService.refresh).toHaveBeenCalledWith(
      {
        hostedUiDomain: mockConfig.cognito.domain,
        clientId: mockConfig.cognito.clientId,
        redirectUri: mockConfig.cognito.redirectUri,
      },
      'rt-sso',
    )
    expect(mockCognitoService.refresh).not.toHaveBeenCalled()
  })

  it('stores a rotated refresh token when Cognito returns one', async () => {
    stubSelectThenValidate()
    mockCognitoService.refresh.mockResolvedValue({ idToken: 'id', refreshToken: 'rt-rotated' })
    const result = await service().refreshSession(currentSession, {
      refreshToken: 'rt-pw',
      kind: 'password',
    })
    expect(result.refresh).toEqual({ refreshToken: 'rt-rotated', kind: 'password' })
  })

  it('does not touch Cognito when select-tenant refuses (status carried for classification)', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse({ error: 'no' }, 403))
    const err = await service()
      .refreshSession(currentSession, { refreshToken: 'rt', kind: 'password' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AuthError)
    expect((err as AuthError).status).toBe(403)
    expect(isRefreshRejected(err)).toBe(true)
    expect(mockCognitoService.refresh).not.toHaveBeenCalled()
  })
})

describe('revokeRefreshToken', () => {
  it('revokes through Cognito RevokeToken for either kind', async () => {
    mockCognitoService.revoke.mockResolvedValue()
    await service().revokeRefreshToken({ refreshToken: 'rt-sso', kind: 'sso' })
    expect(mockCognitoService.revoke).toHaveBeenCalledWith('rt-sso', 'us-east-1_ABC', 'client123')
  })
})

describe('isRefreshRejected', () => {
  it.each([
    ['NotAuthorizedException', undefined],
    ['UserNotFoundException', undefined],
    ['invalid_grant', 400],
    ['ValidateTokenFailed', 401],
    ['SelectTenantFailed', 403],
    ['SelectTenantFailed', 404],
  ])('%s (status %s) → sign in again', (code, status) => {
    expect(isRefreshRejected(new AuthError(code, 'x', status))).toBe(true)
  })

  it.each([
    ['TooManyRequestsException', undefined],
    ['InternalErrorException', undefined],
    ['SelectTenantFailed', 503],
    ['ValidateTokenFailed', 500],
    ['SelectTenantFailed', 429],
    // an unknown OAuth 4xx is not proof the token is dead
    ['invalid_request', 400],
    ['RefreshFailed', 400],
  ])('%s (status %s) → transient, keep the session', (code, status) => {
    expect(isRefreshRejected(new AuthError(code, 'x', status))).toBe(false)
  })

  it.each([
    'Your account has not been granted access. Contact your administrator.',
    'Your account has been deactivated. Contact your administrator.',
    'Your session has expired. Please sign in again.',
    'Authentication failed: this identity provider is disabled.',
  ])('a deliberate Pre-Token denial ends the session: %s', (message) => {
    expect(isRefreshRejected(new AuthError('UserLambdaValidationException', message))).toBe(true)
  })

  it('an unexpected Pre-Token failure (e.g. the database) is transient', () => {
    expect(
      isRefreshRejected(
        new AuthError('UserLambdaValidationException', "Can't reach database server at db:5432"),
      ),
    ).toBe(false)
  })

  it('a network failure (TypeError from fetch) is transient', () => {
    expect(isRefreshRejected(new TypeError('Network request failed'))).toBe(false)
  })
})
