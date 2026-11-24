import * as WebBrowser from 'expo-web-browser'
import * as Crypto from 'expo-crypto'
import { base64UrlEncode } from '@pegasus/auth'
import { AuthError, type CognitoTokens } from './types'

export type OAuthConfig = {
  hostedUiDomain: string
  clientId: string
  redirectUri: string
}

export type OAuthResult = CognitoTokens

/**
 * Generates a cryptographically random PKCE code verifier (43–128 characters).
 * Uses expo-crypto for secure random bytes, then base64url-encodes them.
 */
export async function generateCodeVerifier(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32)
  return base64UrlEncode(bytes)
}

/**
 * Computes the S256 PKCE code challenge: SHA-256 hash of the verifier,
 * base64url-encoded.
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  })
  // Convert standard base64 to base64url
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Opens the Cognito Hosted UI in the system browser, waits for the deep link
 * callback, then exchanges the authorization code for tokens.
 *
 * @param config  Cognito OAuth configuration (domain, clientId, redirectUri)
 * @param providerId  The identity_provider hint — routes directly to the IdP
 * @returns The ID token and refresh token from the Cognito token exchange
 */
export async function authorize(config: OAuthConfig, providerId: string): Promise<OAuthResult> {
  const verifier = await generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
  const state = await generateState()

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    identity_provider: providerId,
  })

  const authorizeUrl = `${config.hostedUiDomain}/oauth2/authorize?${params.toString()}`

  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, config.redirectUri)

  if (result.type !== 'success') {
    throw new AuthError('UserCancelled', 'SSO login was cancelled')
  }

  const callbackUrl = new URL(result.url)
  const code = callbackUrl.searchParams.get('code')
  const returnedState = callbackUrl.searchParams.get('state')

  if (!code) {
    const error =
      callbackUrl.searchParams.get('error_description') ?? 'No authorization code received'
    throw new AuthError('OAuthCallbackFailed', error)
  }

  if (returnedState !== state) {
    throw new AuthError(
      'OAuthStateMismatch',
      'OAuth state parameter mismatch — possible CSRF attack',
    )
  }

  const tokens = await exchangeCodeForTokens(config, code, verifier)
  return tokensOf(tokens)
}

/**
 * Exchanges a refresh token from an SSO sign-in for a fresh ID token via the
 * Hosted UI token endpoint (grant_type=refresh_token; public client, no secret).
 * The caller must POST /api/auth/select-tenant first — the Pre-Token trigger
 * resolves a refresh's tenant from that AuthSession, not from the IdP.
 *
 * Rejects with AuthError('invalid_grant' | …, status) on an HTTP error — an
 * expired or revoked refresh token answers 400 invalid_grant. A network failure
 * rejects with the underlying fetch error.
 */
export async function refresh(config: OAuthConfig, refreshToken: string): Promise<OAuthResult> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    refresh_token: refreshToken,
  })
  const res = await fetch(`${config.hostedUiDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    let code = 'RefreshFailed'
    try {
      const json = (await res.json()) as { error?: string }
      code = json.error ?? code
    } catch {
      // not JSON
    }
    throw new AuthError(code, `Token refresh failed (HTTP ${res.status})`, res.status)
  }
  return tokensOf((await res.json()) as TokenResponse)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function generateState(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16)
  return base64UrlEncode(bytes)
}

type TokenResponse = {
  id_token: string
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

function tokensOf(tokens: TokenResponse): OAuthResult {
  return {
    idToken: tokens.id_token,
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
  }
}

async function exchangeCodeForTokens(
  config: OAuthConfig,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
  })

  const res = await fetch(`${config.hostedUiDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new AuthError(
      'TokenExchangeFailed',
      `Token exchange failed (HTTP ${res.status}): ${text}`,
    )
  }

  return res.json() as Promise<TokenResponse>
}
