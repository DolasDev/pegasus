import { getConfig } from '../config'
import {
  cognitoApiRequest,
  CognitoError,
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from '@pegasus/auth'

// ---------------------------------------------------------------------------
// Cognito auth helpers
//
// Two flows are supported:
//
// 1. Direct password flow (USER_PASSWORD_AUTH)
//    Used for platform admin login. Calls the Cognito Identity Provider API
//    directly — no Hosted UI redirect. Handles the SOFTWARE_TOKEN_MFA
//    challenge for TOTP-enrolled admins.
//
// 2. Authorization Code + PKCE flow
//    Kept for completeness / future federation use. Calls getAuthorizationUrl()
//    which redirects to the Cognito Hosted UI.
// ---------------------------------------------------------------------------

export { CognitoError }

// ---------------------------------------------------------------------------
// Direct password auth (USER_PASSWORD_AUTH)
// ---------------------------------------------------------------------------

/** Parses the AWS region from the Cognito domain. */
function parseRegion(): string {
  const { domain } = getConfig().cognito
  const match = domain.match(/\.auth\.([^.]+)\.amazoncognito\.com/)
  if (!match?.[1]) throw new Error('Cannot parse AWS region from cognito.domain in config.json')
  return match[1]
}

export type SignInResult =
  | { type: 'success'; tokens: TokenSet }
  | { type: 'mfa'; session: string; username: string }

/**
 * Initiates a direct username/password sign-in via USER_PASSWORD_AUTH.
 *
 * Returns `{ type: 'success', tokens }` on successful auth without MFA, or
 * `{ type: 'mfa', session, username }` when a TOTP challenge is required.
 * Call `respondToMfaChallenge()` with the returned session to complete login.
 *
 * Throws `CognitoError` on invalid credentials or other Cognito errors.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const region = parseRegion()
  const json = await cognitoApiRequest(region, 'InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: email, PASSWORD: password },
    ClientId: getConfig().cognito.clientId,
  })

  if (json['ChallengeName'] === 'SOFTWARE_TOKEN_MFA') {
    return { type: 'mfa', session: json['Session'] as string, username: email }
  }

  const result = json['AuthenticationResult'] as {
    AccessToken: string
    IdToken: string
    RefreshToken: string
  }
  const tokens: TokenSet = {
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    refreshToken: result.RefreshToken,
  }
  storeTokens(tokens)
  return { type: 'success', tokens }
}

/**
 * Completes a SOFTWARE_TOKEN_MFA challenge with a TOTP code.
 * The `session` value comes from the `signIn()` mfa result.
 */
export async function respondToMfaChallenge(
  session: string,
  username: string,
  code: string,
): Promise<TokenSet> {
  const region = parseRegion()
  const json = await cognitoApiRequest(region, 'RespondToAuthChallenge', {
    ChallengeName: 'SOFTWARE_TOKEN_MFA',
    ClientId: getConfig().cognito.clientId,
    Session: session,
    ChallengeResponses: { USERNAME: username, SOFTWARE_TOKEN_MFA_CODE: code },
  })

  const result = json['AuthenticationResult'] as {
    AccessToken: string
    IdToken: string
    RefreshToken: string
  }
  const tokens: TokenSet = {
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    refreshToken: result.RefreshToken,
  }
  storeTokens(tokens)
  return tokens
}

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

  const { domain, clientId, redirectUri } = getConfig().cognito
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })

  return `${domain}/oauth2/authorize?${params.toString()}`
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

  if (!verifier)
    throw new Error(
      'Missing code verifier — authorization flow was not initiated from this browser tab.',
    )
  if (returnedState !== expectedState) throw new Error('State mismatch — possible CSRF attempt.')

  sessionStorage.removeItem(STORAGE_KEY_CODE_VERIFIER)
  sessionStorage.removeItem(STORAGE_KEY_STATE)

  const { domain, clientId, redirectUri } = getConfig().cognito
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  })

  const res = await fetch(`${domain}/oauth2/token`, {
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

  const { domain, clientId, redirectUri } = getConfig().cognito
  const params = new URLSearchParams({
    client_id: clientId,
    logout_uri: redirectUri.replace('/auth/callback', '/login'),
  })

  window.location.href = `${domain}/logout?${params.toString()}`
}
