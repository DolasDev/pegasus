import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cognitoApiRequest, CognitoError } from '../cognito-client'

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
