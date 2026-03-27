import { createAuthService } from './authService'
import { AuthError, MobileConfig, Session } from './types'

const mockConfig: MobileConfig = { userPoolId: 'us-east-1_ABC', clientId: 'client123' }
const mockSession: Session = {
  sub: 'sub-1',
  tenantId: 'tenant-1',
  role: 'driver',
  email: 'a@b.com',
  expiresAt: 9999999999,
}

const mockCognitoService = {
  signIn: jest.fn<Promise<{ idToken: string }>, [string, string, string, string]>(),
}

const BASE_URL = 'http://api.test'

beforeEach(() => {
  global.fetch = jest.fn()
  mockCognitoService.signIn.mockReset()
})

describe('createAuthService', () => {
  describe('fetchMobileConfig', () => {
    it('calls GET /api/auth/mobile-config?tenantId=<id> and returns MobileConfig', async () => {
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: mockConfig }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      )

      const { fetchMobileConfig } = createAuthService({
        apiBaseUrl: BASE_URL,
        cognitoService: mockCognitoService,
      })
      const result = await fetchMobileConfig('tenant-1')

      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/auth/mobile-config?tenantId=tenant-1`,
      )
      expect(result).toEqual(mockConfig)
    })

    it('rejects with AuthError(ConfigFetchFailed) when mobile-config returns non-2xx', async () => {
      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(new Response('Not found', { status: 400 })),
      )

      const { fetchMobileConfig } = createAuthService({
        apiBaseUrl: BASE_URL,
        cognitoService: mockCognitoService,
      })

      await expect(fetchMobileConfig('unknown-tenant')).rejects.toThrow(AuthError)

      ;(global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve(new Response('Not found', { status: 400 })),
      )

      try {
        await fetchMobileConfig('unknown-tenant')
      } catch (err) {
        expect((err as AuthError).code).toBe('ConfigFetchFailed')
      }
    })
  })

  describe('authenticate', () => {
    it('calls fetchMobileConfig, signIn, then validate-token in order and returns Session', async () => {
      ;(global.fetch as jest.Mock)
        .mockImplementationOnce(() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: mockConfig }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        )
        .mockImplementationOnce(() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: mockSession }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        )
      mockCognitoService.signIn.mockResolvedValue({ idToken: 'raw-id-token' })

      const { authenticate } = createAuthService({
        apiBaseUrl: BASE_URL,
        cognitoService: mockCognitoService,
      })
      const result = await authenticate('a@b.com', 'pass', 'tenant-1')

      expect(mockCognitoService.signIn).toHaveBeenCalledWith(
        'a@b.com',
        'pass',
        'us-east-1_ABC',
        'client123',
      )
      expect(result).toEqual(mockSession)
      expect(result).not.toHaveProperty('token')
    })

    it('passes idToken from signIn to validate-token body', async () => {
      ;(global.fetch as jest.Mock)
        .mockImplementationOnce(() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: mockConfig }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        )
        .mockImplementationOnce(() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: mockSession }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        )
      mockCognitoService.signIn.mockResolvedValue({ idToken: 'raw-id-token' })

      const { authenticate } = createAuthService({
        apiBaseUrl: BASE_URL,
        cognitoService: mockCognitoService,
      })
      await authenticate('a@b.com', 'pass', 'tenant-1')

      const validateCall = (global.fetch as jest.Mock).mock.calls[1]
      expect(validateCall[0]).toBe(`${BASE_URL}/api/auth/validate-token`)
      const body = JSON.parse(validateCall[1].body as string) as { token: string }
      expect(body.token).toBe('raw-id-token')
    })

    it('rejects with AuthError(ValidateTokenFailed) when validate-token returns non-2xx', async () => {
      ;(global.fetch as jest.Mock)
        .mockImplementationOnce(() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: mockConfig }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        )
        .mockImplementationOnce(() =>
          Promise.resolve(new Response('Unauthorized', { status: 401 })),
        )
      mockCognitoService.signIn.mockResolvedValue({ idToken: 'raw-id-token' })

      const { authenticate } = createAuthService({
        apiBaseUrl: BASE_URL,
        cognitoService: mockCognitoService,
      })

      await expect(authenticate('a@b.com', 'pass', 'tenant-1')).rejects.toThrow(AuthError)

      ;(global.fetch as jest.Mock)
        .mockImplementationOnce(() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: mockConfig }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        )
        .mockImplementationOnce(() =>
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
})
