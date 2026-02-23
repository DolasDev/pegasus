/// <reference types="vite/client" />

// ---------------------------------------------------------------------------
// Cognito — configuration and Hosted UI helpers for the tenant web app.
//
// All configuration is read from Vite environment variables at runtime —
// nothing is hardcoded. This makes the same bundle work in every environment
// (local / staging / production) with different .env files.
//
// Required env vars (see packages/web/.env.example):
//   VITE_COGNITO_REGION         AWS region (e.g. us-east-1)
//   VITE_COGNITO_USER_POOL_ID   User Pool ID (e.g. us-east-1_Abc123)
//   VITE_COGNITO_CLIENT_ID      Tenant app client ID (no secret — PKCE only)
//   VITE_COGNITO_DOMAIN         Hosted UI base URL
//                               (e.g. https://pegasus-123.auth.us-east-1.amazoncognito.com)
//   VITE_COGNITO_REDIRECT_URI   Registered callback URL
//                               (e.g. http://localhost:5173/login/callback)
// ---------------------------------------------------------------------------

export type CognitoConfig = {
  region: string
  userPoolId: string
  clientId: string
  /** Hosted UI base URL — trailing slash stripped. */
  domain: string
  redirectUri: string
}

function requireEnv(key: string): string {
  const value = (import.meta.env as Record<string, string | undefined>)[key]
  if (!value) throw new Error(`Missing required Cognito env var: ${key}`)
  return value
}

// Resolved lazily — does not throw until first call, so Phase 1 mock mode
// (no Cognito env vars) can still boot without errors.
let _config: CognitoConfig | null = null

/** Returns the Cognito config, resolving env vars on the first call. */
export function getCognitoConfig(): CognitoConfig {
  if (!_config) {
    _config = {
      region: requireEnv('VITE_COGNITO_REGION'),
      userPoolId: requireEnv('VITE_COGNITO_USER_POOL_ID'),
      clientId: requireEnv('VITE_COGNITO_CLIENT_ID'),
      domain: requireEnv('VITE_COGNITO_DOMAIN').replace(/\/$/, ''),
      redirectUri: requireEnv('VITE_COGNITO_REDIRECT_URI'),
    }
  }
  return _config
}

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

/**
 * Builds the Cognito Hosted UI authorization URL for an Authorization Code +
 * PKCE flow.
 *
 * The `identity_provider` parameter bypasses the Hosted UI login form and
 * routes the user directly to their IdP. This is provider-agnostic: both
 * OIDC and SAML providers registered in the User Pool use the same parameter;
 * Cognito handles the protocol difference transparently.
 *
 * @param providerId   The Cognito identity provider name (must exactly match
 *                     the name registered in the User Pool).
 * @param codeChallenge  SHA-256 of the PKCE code verifier, base64url-encoded.
 * @param state          Random value for CSRF protection.
 */
export function buildAuthorizeUrl(
  config: CognitoConfig,
  providerId: string,
  codeChallenge: string,
  state: string,
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // Route directly to the specified IdP — no Hosted UI login form is shown.
    // Works identically for OIDC and SAML providers.
    identity_provider: providerId,
  })

  return `${config.domain}/oauth2/authorize?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export type TokenResponse = {
  id_token: string
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

/**
 * Exchanges an authorization code for tokens at the Cognito /oauth2/token
 * endpoint.
 *
 * Called from the browser — the request goes directly to Cognito, not through
 * the Pegasus API. This is correct: with a public app client (no client_secret)
 * and PKCE, the frontend is the authorized party. No proxy is needed.
 *
 * @throws Error if the token endpoint returns a non-200 response.
 */
export async function exchangeCodeForTokens(
  config: CognitoConfig,
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

  const res = await fetch(`${config.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Cognito token exchange failed (HTTP ${res.status}): ${text}`)
  }

  return res.json() as Promise<TokenResponse>
}

// ---------------------------------------------------------------------------
// Logout URL
// ---------------------------------------------------------------------------

/**
 * Builds the Cognito logout URL.
 *
 * Navigating to this URL ends the Cognito SSO session and clears the Cognito
 * session cookie, ensuring the user must re-authenticate with their IdP on
 * the next login. Always clear the local Pegasus session first before
 * navigating here.
 */
export function buildLogoutUrl(config: CognitoConfig): string {
  // logout_uri must be a registered logout URL in the app client.
  // We derive it from redirectUri by replacing /login/callback with /login.
  const logoutUri = config.redirectUri.replace(/\/login\/callback$/, '/login')

  const params = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: logoutUri,
  })

  return `${config.domain}/logout?${params.toString()}`
}
