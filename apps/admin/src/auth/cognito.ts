/// <reference types="vite/client" />

// ---------------------------------------------------------------------------
// Cognito PKCE helpers
//
// Implements the Authorization Code + PKCE flow for the admin SPA.
// No client secret is involved — security relies on the code_verifier /
// code_challenge pair and short-lived authorization codes.
// ---------------------------------------------------------------------------

const DOMAIN = (import.meta.env['VITE_COGNITO_DOMAIN'] as string | undefined) ?? ''
const CLIENT_ID = (import.meta.env['VITE_COGNITO_CLIENT_ID'] as string | undefined) ?? ''
const REDIRECT_URI = (import.meta.env['VITE_COGNITO_REDIRECT_URI'] as string | undefined) ?? ''

const STORAGE_KEY_ACCESS_TOKEN = 'pegasus_admin_access_token'
const STORAGE_KEY_ID_TOKEN = 'pegasus_admin_id_token'
const STORAGE_KEY_REFRESH_TOKEN = 'pegasus_admin_refresh_token'
const STORAGE_KEY_CODE_VERIFIER = 'pegasus_admin_code_verifier'
const STORAGE_KEY_STATE = 'pegasus_admin_state'

export interface TokenSet {
  accessToken: string
  idToken: string
  refreshToken: string
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let str = ''
  for (const byte of bytes) {
    str += String.fromCharCode(byte)
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return base64UrlEncode(array.buffer)
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(digest)
}

function generateState(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return base64UrlEncode(array.buffer)
}

// ---------------------------------------------------------------------------
// Authorization URL — call this to kick off the login flow
// ---------------------------------------------------------------------------

/**
 * Builds the Cognito Hosted UI authorization URL with a fresh PKCE verifier
 * and CSRF state token. Stores the verifier + state in sessionStorage so the
 * callback page can complete the exchange.
 */
export async function getAuthorizationUrl(): Promise<string> {
  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
  const state = generateState()

  sessionStorage.setItem(STORAGE_KEY_CODE_VERIFIER, verifier)
  sessionStorage.setItem(STORAGE_KEY_STATE, state)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid email profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })

  return `${DOMAIN}/oauth2/authorize?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Token exchange — call this in the /auth/callback route
// ---------------------------------------------------------------------------

/**
 * Exchanges an authorization code for tokens. The code_verifier stored during
 * `getAuthorizationUrl()` is consumed here and cleared from sessionStorage.
 *
 * Throws if the verifier is missing (e.g., page was refreshed mid-flow) or
 * if the token endpoint returns a non-2xx response.
 */
export async function exchangeCode(code: string, returnedState: string): Promise<TokenSet> {
  const verifier = sessionStorage.getItem(STORAGE_KEY_CODE_VERIFIER)
  const expectedState = sessionStorage.getItem(STORAGE_KEY_STATE)

  if (!verifier) throw new Error('Missing code verifier — authorization flow was not initiated from this browser tab.')
  if (returnedState !== expectedState) throw new Error('State mismatch — possible CSRF attempt.')

  sessionStorage.removeItem(STORAGE_KEY_CODE_VERIFIER)
  sessionStorage.removeItem(STORAGE_KEY_STATE)

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  })

  const res = await fetch(`${DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${text}`)
  }

  const json = (await res.json()) as {
    access_token: string
    id_token: string
    refresh_token: string
  }

  const tokens: TokenSet = {
    accessToken: json.access_token,
    idToken: json.id_token,
    refreshToken: json.refresh_token,
  }

  storeTokens(tokens)
  return tokens
}

// ---------------------------------------------------------------------------
// Token storage helpers
// ---------------------------------------------------------------------------

export function storeTokens(tokens: TokenSet): void {
  sessionStorage.setItem(STORAGE_KEY_ACCESS_TOKEN, tokens.accessToken)
  sessionStorage.setItem(STORAGE_KEY_ID_TOKEN, tokens.idToken)
  sessionStorage.setItem(STORAGE_KEY_REFRESH_TOKEN, tokens.refreshToken)
}

export function getAccessToken(): string | null {
  return sessionStorage.getItem(STORAGE_KEY_ACCESS_TOKEN)
}

export function clearTokens(): void {
  sessionStorage.removeItem(STORAGE_KEY_ACCESS_TOKEN)
  sessionStorage.removeItem(STORAGE_KEY_ID_TOKEN)
  sessionStorage.removeItem(STORAGE_KEY_REFRESH_TOKEN)
}

// ---------------------------------------------------------------------------
// Sign-out — revoke token + redirect to Cognito logout endpoint
// ---------------------------------------------------------------------------

/**
 * Clears local tokens and redirects to the Cognito Hosted UI logout endpoint,
 * which invalidates the Cognito session cookie and then redirects back to
 * the admin login page.
 */
export function signOut(): void {
  clearTokens()

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    logout_uri: REDIRECT_URI.replace('/auth/callback', '/login'),
  })

  window.location.href = `${DOMAIN}/logout?${params.toString()}`
}
