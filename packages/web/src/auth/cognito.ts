import { getConfig } from '../config'

// ---------------------------------------------------------------------------
// Cognito — configuration and Hosted UI helpers for the tenant web app.
//
// All configuration is read from the runtime /config.json (loaded at boot).
// ---------------------------------------------------------------------------

export type CognitoConfig = {
  region: string
  userPoolId: string
  clientId: string
  /** Hosted UI base URL — trailing slash stripped. */
  domain: string
  redirectUri: string
}

/** Returns the Cognito config from the runtime config loaded at boot. */
export function getCognitoConfig(): CognitoConfig {
  return getConfig().cognito
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
// Direct password auth (USER_PASSWORD_AUTH)
//
// Used when a tenant's domain is registered but no SSO providers are
// configured yet. The tenant admin uses this path to log in and set up SSO,
// after which regular users can authenticate via the PKCE/IdP flow above.
// ---------------------------------------------------------------------------

/** Typed error carrying the Cognito error code (e.g. NotAuthorizedException). */
export class CognitoError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = code
  }
}

async function cognitoApiRequest(
  region: string,
  target: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  })

  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    throw new CognitoError(
      (json['__type'] as string | undefined) ?? 'UnknownError',
      (json['message'] as string | undefined) ?? 'Authentication failed',
    )
  }
  return json
}

export type SignInResult =
  | { type: 'success'; idToken: string }
  | { type: 'mfa'; session: string; username: string }

/**
 * Initiates a direct username/password sign-in via USER_PASSWORD_AUTH.
 *
 * Returns `{ type: 'success', idToken }` on success, or
 * `{ type: 'mfa', session, username }` when a TOTP challenge is required.
 * Call `respondToMfaChallenge()` with the returned session to complete login.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const { region, clientId } = getCognitoConfig()
  const json = await cognitoApiRequest(region, 'InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: email, PASSWORD: password },
    ClientId: clientId,
  })

  if (json['ChallengeName'] === 'SOFTWARE_TOKEN_MFA') {
    return { type: 'mfa', session: json['Session'] as string, username: email }
  }

  const result = json['AuthenticationResult'] as { IdToken: string }
  return { type: 'success', idToken: result.IdToken }
}

/**
 * Completes a SOFTWARE_TOKEN_MFA challenge with a TOTP code.
 * The `session` value comes from the `signIn()` mfa result.
 */
export async function respondToMfaChallenge(
  session: string,
  username: string,
  code: string,
): Promise<{ idToken: string }> {
  const { region, clientId } = getCognitoConfig()
  const json = await cognitoApiRequest(region, 'RespondToAuthChallenge', {
    ChallengeName: 'SOFTWARE_TOKEN_MFA',
    ClientId: clientId,
    Session: session,
    ChallengeResponses: { USERNAME: username, SOFTWARE_TOKEN_MFA_CODE: code },
  })

  const result = json['AuthenticationResult'] as { IdToken: string }
  return { idToken: result.IdToken }
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
