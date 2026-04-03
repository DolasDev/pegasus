import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signIn, respondToNewPasswordChallenge, CognitoError } from '../auth/cognito'

// Mock getConfig so getCognitoConfig() works without a live config.json at boot.
vi.mock('../config', () => ({
  getConfig: () => ({
    apiUrl: 'https://api.example.com',
    cognito: {
      region: 'us-east-1',
      userPoolId: 'us-east-1_test',
      clientId: 'test-client-id',
      domain: 'https://auth.example.com',
      redirectUri: 'https://app.example.com/login/callback',
    },
  }),
}))

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
})

function mockCognitoResponse(body: Record<string, unknown>, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

describe('signIn', () => {
  it('returns { type: "success", idToken } on successful authentication', async () => {
    mockCognitoResponse({
      AuthenticationResult: { IdToken: 'id-token-abc', AccessToken: 'access-abc' },
    })

    const result = await signIn('user@example.com', 'Password1!')
    expect(result).toEqual({ type: 'success', idToken: 'id-token-abc' })
  })

  it('returns { type: "mfa", session, username } on SOFTWARE_TOKEN_MFA challenge', async () => {
    mockCognitoResponse({
      ChallengeName: 'SOFTWARE_TOKEN_MFA',
      Session: 'session-token-xyz',
      ChallengeParameters: {},
    })

    const result = await signIn('user@example.com', 'Password1!')
    expect(result).toEqual({
      type: 'mfa',
      session: 'session-token-xyz',
      username: 'user@example.com',
    })
  })

  it('returns { type: "new_password_required", session, username } on NEW_PASSWORD_REQUIRED challenge', async () => {
    mockCognitoResponse({
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      Session: 'new-pw-session',
      ChallengeParameters: {
        requiredAttributes: '[]',
        userAttributes: '{"email_verified":"true","email":"user@example.com"}',
      },
    })

    const result = await signIn('user@example.com', 'TempPassword1!')
    expect(result).toEqual({
      type: 'new_password_required',
      session: 'new-pw-session',
      username: 'user@example.com',
    })
  })

  it('throws CognitoError with the Cognito error code on a non-200 response', async () => {
    mockCognitoResponse(
      { __type: 'NotAuthorizedException', message: 'Incorrect username or password.' },
      400,
    )

    const err = await signIn('user@example.com', 'WrongPass!').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CognitoError)
    expect((err as CognitoError).code).toBe('NotAuthorizedException')
  })
})

describe('respondToNewPasswordChallenge', () => {
  it('returns { idToken } after the user sets a permanent password', async () => {
    mockCognitoResponse({
      AuthenticationResult: { IdToken: 'new-id-token', AccessToken: 'new-access' },
    })

    const result = await respondToNewPasswordChallenge(
      'new-pw-session',
      'user@example.com',
      'NewPassword1!',
    )
    expect(result).toEqual({ idToken: 'new-id-token' })
  })

  it('sends the correct Cognito target and challenge payload', async () => {
    mockCognitoResponse({
      AuthenticationResult: { IdToken: 'tok', AccessToken: 'acc' },
    })

    await respondToNewPasswordChallenge('sess', 'user@example.com', 'NewPass1!')

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://cognito-idp.us-east-1.amazonaws.com/')
    expect(init.headers).toMatchObject({
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.RespondToAuthChallenge',
    })
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      ClientId: 'test-client-id',
      Session: 'sess',
      ChallengeResponses: { USERNAME: 'user@example.com', NEW_PASSWORD: 'NewPass1!' },
    })
  })

  it('throws CognitoError when the new password violates the policy', async () => {
    mockCognitoResponse(
      { __type: 'InvalidPasswordException', message: 'Password does not conform to policy.' },
      400,
    )

    await expect(
      respondToNewPasswordChallenge('bad-session', 'user@example.com', 'weak'),
    ).rejects.toThrow(CognitoError)
  })
})
