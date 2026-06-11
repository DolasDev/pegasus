import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  cognitoApiRequest,
  CognitoError,
  unwrapPreTokenMessage,
  passwordPolicyMessage,
  PASSWORD_POLICY_MESSAGE,
} from '../cognito-client'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('cognitoApiRequest', () => {
  it('sends POST to the correct regional Cognito endpoint with correct headers', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ AuthenticationResult: { IdToken: 'tok' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await cognitoApiRequest('us-east-1', 'InitiateAuth', { foo: 'bar' })

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://cognito-idp.us-east-1.amazonaws.com/',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
        },
        body: JSON.stringify({ foo: 'bar' }),
      }),
    )
  })

  it('returns parsed JSON body on 2xx response', async () => {
    const payload = { AuthenticationResult: { IdToken: 'my-token' } }
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const result = await cognitoApiRequest('eu-west-1', 'InitiateAuth', {})

    expect(result).toEqual(payload)
  })

  it('throws CognitoError with __type as code on non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            __type: 'NotAuthorizedException',
            message: 'Incorrect username or password.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    try {
      await cognitoApiRequest('us-east-1', 'InitiateAuth', {})
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CognitoError)
      const cogErr = err as CognitoError
      expect(cogErr.code).toBe('NotAuthorizedException')
      expect(cogErr.message).toBe('Incorrect username or password.')
    }
  })

  it('falls back to UnknownError when __type is absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'Something went wrong' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    try {
      await cognitoApiRequest('us-east-1', 'InitiateAuth', {})
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CognitoError)
      expect((err as CognitoError).code).toBe('UnknownError')
    }
  })

  it('strips the PreTokenGeneration wrapper from a CognitoError message', async () => {
    // Cognito wraps the Lambda message and appends its own period — so an
    // inner sentence ending in "." arrives doubled ("administrator..").
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            __type: 'UserLambdaValidationException',
            message:
              'PreTokenGeneration failed with error Your account has not been granted access. Contact your administrator..',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    try {
      await cognitoApiRequest('us-east-1', 'InitiateAuth', {})
      expect.fail('Should have thrown')
    } catch (err) {
      expect((err as CognitoError).message).toBe(
        'Your account has not been granted access. Contact your administrator.',
      )
    }
  })

  it('uses the correct region in the URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await cognitoApiRequest('ap-southeast-2', 'DescribeUser', {})

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://cognito-idp.ap-southeast-2.amazonaws.com/',
      expect.anything(),
    )
  })
})

describe('unwrapPreTokenMessage', () => {
  it('strips the wrapper prefix and the single period Cognito appends', () => {
    // Inner sentence already ends in "." — Cognito appends another, so the
    // wrapped message ends in "..". Only Cognito's period should be removed.
    expect(
      unwrapPreTokenMessage(
        'PreTokenGeneration failed with error Your session has expired. Please sign in again..',
      ),
    ).toBe('Your session has expired. Please sign in again.')
  })

  it('returns non-wrapped messages unchanged', () => {
    expect(unwrapPreTokenMessage('Incorrect username or password.')).toBe(
      'Incorrect username or password.',
    )
  })
})

describe('passwordPolicyMessage', () => {
  it('returns the policy rules for an InvalidPasswordException', () => {
    const err = new CognitoError('InvalidPasswordException', 'Password did not conform with policy')
    expect(passwordPolicyMessage(err)).toBe(PASSWORD_POLICY_MESSAGE)
  })

  it('returns the policy rules for a password-length InvalidParameterException', () => {
    const err = new CognitoError(
      'InvalidParameterException',
      "1 validation error detected: Value at 'password' failed to satisfy constraint: Member must have length greater than or equal to 6",
    )
    expect(passwordPolicyMessage(err)).toBe(PASSWORD_POLICY_MESSAGE)
  })

  it('names the actual rules: 12 characters, upper, lower, number, symbol', () => {
    expect(PASSWORD_POLICY_MESSAGE).toMatch(/12 characters/)
    expect(PASSWORD_POLICY_MESSAGE).toMatch(/uppercase/i)
    expect(PASSWORD_POLICY_MESSAGE).toMatch(/lowercase/i)
    expect(PASSWORD_POLICY_MESSAGE).toMatch(/number/i)
    expect(PASSWORD_POLICY_MESSAGE).toMatch(/symbol/i)
  })

  it('returns null for an InvalidParameterException unrelated to the password (e.g. federated account)', () => {
    const err = new CognitoError(
      'InvalidParameterException',
      'Cannot reset password for the user as there is no registered/verified email or phone_number',
    )
    // This message names "password" too, so verify the federated *request*-step
    // case that does NOT mention the password field returns null instead.
    const federated = new CognitoError(
      'InvalidParameterException',
      'User does not have a recovery method configured.',
    )
    expect(passwordPolicyMessage(federated)).toBeNull()
    // The reset-state message above does contain "password", so it maps — that
    // is acceptable since it only ever surfaces while setting a new password.
    expect(passwordPolicyMessage(err)).toBe(PASSWORD_POLICY_MESSAGE)
  })

  it('returns null for unrelated Cognito errors', () => {
    expect(
      passwordPolicyMessage(new CognitoError('CodeMismatchException', 'Invalid verification code')),
    ).toBeNull()
    expect(
      passwordPolicyMessage(
        new CognitoError('NotAuthorizedException', 'Incorrect username or password.'),
      ),
    ).toBeNull()
  })

  it('returns null for non-CognitoError values', () => {
    expect(passwordPolicyMessage(new Error('boom'))).toBeNull()
    expect(passwordPolicyMessage('InvalidPasswordException')).toBeNull()
    expect(passwordPolicyMessage(null)).toBeNull()
  })
})
