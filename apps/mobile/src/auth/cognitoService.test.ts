import { refresh, revoke, signIn } from './cognitoService'
import { AuthError } from './types'

// Mock global fetch
const mockFetch = jest.fn() as jest.Mock
global.fetch = mockFetch

describe('cognitoService', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  describe('signIn', () => {
    it('resolves with { idToken } on successful USER_PASSWORD_AUTH', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          AuthenticationResult: { IdToken: 'mock-id-token' },
        }),
      })

      const result = await signIn('user@test.com', 'password', 'us-east-1_ABC', 'client123')

      expect(result).toEqual({ idToken: 'mock-id-token' })
      expect(mockFetch).toHaveBeenCalledWith(
        'https://cognito-idp.us-east-1.amazonaws.com/',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            AuthFlow: 'USER_PASSWORD_AUTH',
            AuthParameters: { USERNAME: 'user@test.com', PASSWORD: 'password' },
            ClientId: 'client123',
          }),
        }),
      )
    })

    it('rejects with AuthError on NotAuthorizedException', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({
          __type: 'NotAuthorizedException',
          message: 'Incorrect username or password.',
        }),
      })

      await expect(signIn('user@test.com', 'wrong', 'us-east-1_ABC', 'client123')).rejects.toThrow(
        AuthError,
      )

      try {
        await signIn('user@test.com', 'wrong', 'us-east-1_ABC', 'client123')
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError)
        expect((err as AuthError).code).toBe('NotAuthorizedException')
      }
    })

    it('rejects with AuthError(NewPasswordRequired) on password change challenge', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ChallengeName: 'NEW_PASSWORD_REQUIRED',
        }),
      })

      await expect(signIn('user@test.com', 'pass', 'us-east-1_ABC', 'client123')).rejects.toThrow(
        AuthError,
      )

      try {
        await signIn('user@test.com', 'pass', 'us-east-1_ABC', 'client123')
      } catch (err) {
        expect((err as AuthError).code).toBe('NewPasswordRequired')
      }
    })

    it('rejects with AuthError(UnknownError) when __type is absent', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Something went wrong' }),
      })

      try {
        await signIn('user@test.com', 'pass', 'us-east-1_ABC', 'client123')
      } catch (err) {
        expect((err as AuthError).code).toBe('UnknownError')
      }
    })

    it('extracts region from poolId', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          AuthenticationResult: { IdToken: 'token' },
        }),
      })

      await signIn('user@test.com', 'pass', 'eu-west-2_XyZ', 'client123')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://cognito-idp.eu-west-2.amazonaws.com/',
        expect.anything(),
      )
    })

    it('returns the refresh token alongside the ID token', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          AuthenticationResult: { IdToken: 'id', RefreshToken: 'rt' },
        }),
      })
      await expect(signIn('u@test.com', 'p', 'us-east-1_ABC', 'client123')).resolves.toEqual({
        idToken: 'id',
        refreshToken: 'rt',
      })
    })
  })

  describe('refresh', () => {
    it('calls InitiateAuth REFRESH_TOKEN_AUTH and returns the new ID token', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ AuthenticationResult: { IdToken: 'new-id' } }),
      })

      await expect(refresh('rt', 'us-east-1_ABC', 'client123')).resolves.toEqual({
        idToken: 'new-id',
      })
      const [url, init] = mockFetch.mock.calls[0]!
      expect(url).toBe('https://cognito-idp.us-east-1.amazonaws.com/')
      expect(init.headers['X-Amz-Target']).toBe('AWSCognitoIdentityProviderService.InitiateAuth')
      expect(JSON.parse(init.body)).toEqual({
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        AuthParameters: { REFRESH_TOKEN: 'rt' },
        ClientId: 'client123',
      })
    })

    it('rejects with AuthError(NotAuthorizedException) for an expired or revoked token', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({
          __type: 'NotAuthorizedException',
          message: 'Refresh Token has expired',
        }),
      })
      await expect(refresh('rt', 'us-east-1_ABC', 'client123')).rejects.toMatchObject({
        code: 'NotAuthorizedException',
      })
    })
  })

  describe('revoke', () => {
    it('calls RevokeToken with the token and client id', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
      await revoke('rt', 'us-east-1_ABC', 'client123')
      const [, init] = mockFetch.mock.calls[0]!
      expect(init.headers['X-Amz-Target']).toBe('AWSCognitoIdentityProviderService.RevokeToken')
      expect(JSON.parse(init.body)).toEqual({ Token: 'rt', ClientId: 'client123' })
    })
  })
})
