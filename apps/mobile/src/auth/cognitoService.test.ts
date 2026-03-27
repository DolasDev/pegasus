// IMPORTANT: Use var (not const/let) for mock variables referenced inside jest.mock() factory.
// Jest hoists jest.mock() calls before imports but NOT const/let declarations.
// var declarations ARE hoisted, so they are safe to use inside the factory.
// See RESEARCH.md Pitfall 1.
var mockAuthenticateUser = jest.fn()

jest.mock('amazon-cognito-identity-js', () => ({
  CognitoUserPool: jest.fn(),
  CognitoUser: jest.fn().mockImplementation(() => ({
    authenticateUser: mockAuthenticateUser,
  })),
  AuthenticationDetails: jest.fn(),
}))

import { signIn } from './cognitoService'
import { AuthError } from './types'

describe('cognitoService', () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset()
  })

  describe('signIn', () => {
    it('resolves with { idToken } on successful SRP auth', async () => {
      mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { onSuccess: (s: unknown) => void }) => {
        callbacks.onSuccess({
          getIdToken: () => ({ getJwtToken: () => 'mock-id-token' }),
        })
      })

      const result = await signIn('user@test.com', 'password', 'us-east-1_ABC', 'client123')

      expect(result).toEqual({ idToken: 'mock-id-token' })
    })

    it('rejects with AuthError on NotAuthorizedException', async () => {
      mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { onFailure: (e: unknown) => void }) => {
        callbacks.onFailure({ code: 'NotAuthorizedException', message: 'Incorrect username or password.' })
      })

      await expect(signIn('user@test.com', 'wrong', 'us-east-1_ABC', 'client123')).rejects.toThrow(AuthError)

      try {
        await signIn('user@test.com', 'wrong', 'us-east-1_ABC', 'client123')
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError)
        expect(err).toBeInstanceOf(Error)
        expect((err as AuthError).code).toBe('NotAuthorizedException')
      }
    })

    it('rejects with AuthError(NewPasswordRequired) on password change challenge', async () => {
      mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { newPasswordRequired: () => void }) => {
        callbacks.newPasswordRequired()
      })

      await expect(signIn('user@test.com', 'pass', 'us-east-1_ABC', 'client123')).rejects.toThrow(AuthError)

      try {
        await signIn('user@test.com', 'pass', 'us-east-1_ABC', 'client123')
      } catch (err) {
        expect((err as AuthError).code).toBe('NewPasswordRequired')
      }
    })

    it('rejects with AuthError(UnknownError) when err.code is absent', async () => {
      mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { onFailure: (e: unknown) => void }) => {
        callbacks.onFailure({ message: 'Something went wrong' })
      })

      try {
        await signIn('user@test.com', 'pass', 'us-east-1_ABC', 'client123')
      } catch (err) {
        expect((err as AuthError).code).toBe('UnknownError')
      }
    })
  })
})
