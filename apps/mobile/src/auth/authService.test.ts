import { createAuthService } from './authService'
import { AuthError, type Session, type TenantResolution } from './types'
import type { MobileConfig } from '../config'

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
  signIn: jest.fn<Promise<{ idToken: string }>, [string, string, string, string]>(),
}

const mockOAuthService = {
  authorize: jest.fn<Promise<{ idToken: string }>, [Record<string, string>, string]>(),
}

beforeEach(() => {
  global.fetch = jest.fn()
  mockCognitoService.signIn.mockReset()
  mockOAuthService.authorize.mockReset()
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
      expect(result).toEqual({ ...mockApiSession, token: 'raw-id-token' })
      expect(result.token).toBe('raw-id-token')
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
      expect(result).toEqual({ ...mockApiSession, token: 'sso-id-token' })
      expect(result.token).toBe('sso-id-token')
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
