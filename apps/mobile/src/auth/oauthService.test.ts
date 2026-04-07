import { AuthError } from './types'
import * as WebBrowser from 'expo-web-browser'
import * as Crypto from 'expo-crypto'

import {
  generateCodeVerifier,
  generateCodeChallenge,
  authorize,
  type OAuthConfig,
} from './oauthService'

const mockConfig: OAuthConfig = {
  hostedUiDomain: 'https://pegasus-test.auth.us-east-1.amazoncognito.com',
  clientId: 'mobile-client-id',
  redirectUri: 'movingapp://auth/callback',
}

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn()
})

describe('generateCodeVerifier', () => {
  it('returns a base64url string of at least 43 characters', async () => {
    // 32 bytes → 43 base64url characters (no padding)
    const fakeBytes = new Uint8Array(32)
    for (let i = 0; i < 32; i++) fakeBytes[i] = i + 65
    ;(Crypto.getRandomBytesAsync as jest.Mock).mockResolvedValueOnce(fakeBytes)

    const verifier = await generateCodeVerifier()

    expect(verifier.length).toBeGreaterThanOrEqual(43)
    // base64url: only alphanumeric, -, _
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('generateCodeChallenge', () => {
  it('returns base64url-encoded SHA-256 of the verifier', async () => {
    // Mock digest returns standard base64 with +/= characters
    ;(Crypto.digestStringAsync as jest.Mock).mockResolvedValueOnce('a+b/c==')

    const challenge = await generateCodeChallenge('test-verifier')

    // Should convert + → -, / → _, strip =
    expect(challenge).toBe('a-b_c')
    expect(Crypto.digestStringAsync).toHaveBeenCalledWith('SHA-256', 'test-verifier', {
      encoding: 'base64',
    })
  })
})

describe('authorize', () => {
  /** Sets up mocks for a full successful OAuth flow. */
  function setupMocks(overrides?: {
    browserResult?: Partial<WebBrowser.WebBrowserAuthSessionResult>
    fetchResponse?: Response
  }) {
    const fakeBytes32 = new Uint8Array(32).fill(65) // verifier bytes
    const fakeBytes16 = new Uint8Array(16).fill(66) // state bytes
    ;(Crypto.getRandomBytesAsync as jest.Mock)
      .mockResolvedValueOnce(fakeBytes32) // code verifier
      .mockResolvedValueOnce(fakeBytes16) // state
    ;(Crypto.digestStringAsync as jest.Mock).mockResolvedValueOnce('mock-challenge')

    // Compute expected state value for matching
    const state = btoa(String.fromCharCode(...fakeBytes16))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    const browserResult = overrides?.browserResult ?? {
      type: 'success' as const,
      url: `movingapp://auth/callback?code=auth-code-123&state=${state}`,
    }
    ;(WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce(browserResult)

    const fetchResponse =
      overrides?.fetchResponse ??
      new Response(
        JSON.stringify({
          id_token: 'mock-id-token',
          access_token: 'mock-access-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(fetchResponse)

    return { state }
  }

  it('opens browser with correct authorize URL parameters', async () => {
    setupMocks()

    await authorize(mockConfig, 'GoogleSSO')

    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledTimes(1)
    const [url, redirectUri] = (WebBrowser.openAuthSessionAsync as jest.Mock).mock.calls[0]
    expect(redirectUri).toBe('movingapp://auth/callback')

    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe(
      'https://pegasus-test.auth.us-east-1.amazoncognito.com/oauth2/authorize',
    )
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('client_id')).toBe('mobile-client-id')
    expect(parsed.searchParams.get('redirect_uri')).toBe('movingapp://auth/callback')
    expect(parsed.searchParams.get('scope')).toBe('openid email profile')
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
    expect(parsed.searchParams.get('identity_provider')).toBe('GoogleSSO')
    expect(parsed.searchParams.get('code_challenge')).toBeTruthy()
    expect(parsed.searchParams.get('state')).toBeTruthy()
  })

  it('exchanges code for tokens and returns idToken on success', async () => {
    setupMocks()

    const result = await authorize(mockConfig, 'GoogleSSO')

    expect(result).toEqual({ idToken: 'mock-id-token' })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [tokenUrl, tokenOpts] = (global.fetch as jest.Mock).mock.calls[0]
    expect(tokenUrl).toBe('https://pegasus-test.auth.us-east-1.amazoncognito.com/oauth2/token')
    expect(tokenOpts.method).toBe('POST')
    expect(tokenOpts.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  })

  it('throws AuthError(UserCancelled) when user dismisses the browser', async () => {
    setupMocks({ browserResult: { type: 'cancel' as const } })

    try {
      await authorize(mockConfig, 'GoogleSSO')
      fail('Expected authorize to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError)
      expect((err as AuthError).code).toBe('UserCancelled')
    }
  })

  it('throws AuthError(OAuthCallbackFailed) when callback has no code', async () => {
    setupMocks({
      browserResult: {
        type: 'success' as const,
        url: 'movingapp://auth/callback?error=access_denied&error_description=User+denied',
      },
    })

    try {
      await authorize(mockConfig, 'GoogleSSO')
      fail('Expected authorize to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError)
      expect((err as AuthError).code).toBe('OAuthCallbackFailed')
      expect((err as AuthError).message).toContain('User denied')
    }
  })

  it('throws AuthError(TokenExchangeFailed) when token endpoint returns non-2xx', async () => {
    setupMocks({
      fetchResponse: new Response('invalid_grant', { status: 400 }),
    })

    try {
      await authorize(mockConfig, 'GoogleSSO')
      fail('Expected authorize to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError)
      expect((err as AuthError).code).toBe('TokenExchangeFailed')
    }
  })
})
