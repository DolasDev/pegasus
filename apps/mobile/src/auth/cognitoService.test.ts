import { signIn } from './cognitoService'
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
  })
})
