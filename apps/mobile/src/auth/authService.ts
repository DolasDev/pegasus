import { normalizeEmail } from '@pegasus/auth'
import {
  AuthError,
  type CognitoTokens,
  type Session,
  type SignInResult,
  type StoredRefresh,
  type TenantResolution,
} from './types'
import type { MobileConfig } from '../config'
import type { OAuthConfig } from './oauthService'

type CognitoService = {
  signIn(email: string, password: string, poolId: string, clientId: string): Promise<CognitoTokens>
  refresh(refreshToken: string, poolId: string, clientId: string): Promise<CognitoTokens>
  revoke(refreshToken: string, poolId: string, clientId: string): Promise<void>
}

type OAuthService = {
  authorize(config: OAuthConfig, providerId: string): Promise<CognitoTokens>
  refresh(config: OAuthConfig, refreshToken: string): Promise<CognitoTokens>
}

type AuthServiceDeps = {
  config: MobileConfig
  cognitoService: CognitoService
  oauthService: OAuthService
}

/**
 * Cognito (InitiateAuth) and OAuth (/oauth2/token) error codes meaning "this
 * refresh token will never work again": expired, revoked, or the user gone or
 * disabled.
 */
const REJECTED_TOKEN_CODES = new Set([
  'NotAuthorizedException',
  'UserNotFoundException',
  'invalid_grant',
  'invalid_client',
  'unauthorized_client',
])

/**
 * Cognito wraps ANY Pre-Token trigger throw as UserLambdaValidationException —
 * a deliberate denial and a database blip alike. Only the trigger's deliberate
 * denials (apps/api/src/cognito/pre-token.ts: no roster row, deactivated,
 * ambiguous tenant, bad provider) end the session; anything else is treated as
 * an outage, so a backend incident doesn't sign every driver out. Keep in step
 * with the messages pre-token.ts throws.
 */
const PRE_TOKEN_DENIALS = [
  /not been granted access/i,
  /has been deactivated/i,
  /session has expired/i,
  /^Authentication failed/i,
]

/** Our own API's auth endpoints: a 4xx is a denial (not invited, deactivated, bad token). */
const API_ERROR_CODES = new Set(['SelectTenantFailed', 'ValidateTokenFailed'])

/**
 * True when a refresh failed because the session can't be renewed, so the
 * driver must sign in again. False for transient failures (no network, 5xx,
 * throttling, an unexpected trigger error), where the app keeps the session and
 * retries later — a driver in a dead zone, or a backend incident, must not sign
 * everyone out.
 */
export function isRefreshRejected(err: unknown): boolean {
  if (!(err instanceof AuthError)) return false
  if (REJECTED_TOKEN_CODES.has(err.code)) return true
  if (err.code === 'UserLambdaValidationException') {
    return PRE_TOKEN_DENIALS.some((re) => re.test(err.message))
  }
  if (API_ERROR_CODES.has(err.code)) {
    return err.status !== undefined && err.status >= 400 && err.status < 500 && err.status !== 429
  }
  return false
}

/**
 * Creates an authService instance with injected dependencies.
 *
 * Usage (production):
 *   import { getMobileConfig } from '../config'
 *   const config = getMobileConfig()
 *   const authService = createAuthService({ config, cognitoService, oauthService })
 *
 * The factory pattern enables tests to inject a mock cognitoService without
 * jest.mock() module patching (D-05). Config is baked in at build time via
 * EXPO_PUBLIC_* env vars — no runtime fetch needed (D-06).
 */
export function createAuthService({ config, cognitoService, oauthService }: AuthServiceDeps) {
  const { apiUrl, cognito } = config

  function oauthConfig(): OAuthConfig {
    if (!cognito.domain) {
      throw new AuthError('SsoNotConfigured', 'SSO is not configured for this environment')
    }
    return {
      hostedUiDomain: cognito.domain,
      clientId: cognito.clientId,
      redirectUri: cognito.redirectUri,
    }
  }

  /** POST /api/auth/validate-token → the server-validated Session for this ID token. */
  async function validate(idToken: string): Promise<Session> {
    const res = await fetch(`${apiUrl}/api/auth/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })

    if (!res.ok) {
      throw new AuthError(
        'ValidateTokenFailed',
        `validate-token returned ${res.status}`,
        res.status,
      )
    }

    const body = (await res.json()) as { data: Session }
    return { ...body.data, token: idToken }
  }

  function refreshOf(tokens: CognitoTokens, kind: StoredRefresh['kind']): StoredRefresh | null {
    return tokens.refreshToken ? { refreshToken: tokens.refreshToken, kind } : null
  }

  /**
   * Authenticates the driver via two sequential steps:
   *  1. cognitoService.signIn(email, password, userPoolId, clientId) → tokens
   *  2. POST /api/auth/validate-token with { idToken } → { data: Session }
   *
   * Returns the server-validated Session plus the refresh token to keep
   * (stored apart from the session by AuthContext).
   *
   * Rejects with AuthError on any failure in any step.
   */
  async function authenticate(
    email: string,
    password: string,
    _tenantId: string,
  ): Promise<SignInResult> {
    // Cognito usernames are case-sensitive — always sign in with the lower-cased email.
    const tokens = await cognitoService.signIn(
      normalizeEmail(email),
      password,
      cognito.userPoolId,
      cognito.clientId,
    )
    return { session: await validate(tokens.idToken), refresh: refreshOf(tokens, 'password') }
  }

  /**
   * Resolves the list of tenants the given email belongs to.
   * Calls POST /api/auth/resolve-tenants.
   * Returns [] when no tenants match (200 with empty array) — does NOT throw (D-04).
   * Throws AuthError('ResolveTenantsFailed') on non-2xx.
   */
  async function resolveTenants(email: string): Promise<TenantResolution[]> {
    const res = await fetch(`${apiUrl}/api/auth/resolve-tenants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizeEmail(email) }),
    })
    if (!res.ok) {
      throw new AuthError(
        'ResolveTenantsFailed',
        `resolve-tenants returned ${res.status}`,
        res.status,
      )
    }
    const body = (await res.json()) as { data: TenantResolution[] }
    return body.data
  }

  /**
   * Confirms tenant selection for the given email+tenantId pair.
   * Calls POST /api/auth/select-tenant.
   * Returns void on success.
   * Throws AuthError('SelectTenantFailed') on non-2xx (D-05).
   */
  async function selectTenant(email: string, tenantId: string): Promise<void> {
    const res = await fetch(`${apiUrl}/api/auth/select-tenant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizeEmail(email), tenantId }),
    })
    if (!res.ok) {
      throw new AuthError('SelectTenantFailed', `select-tenant returned ${res.status}`, res.status)
    }
  }

  /**
   * Authenticates the driver via SSO (OAuth2 Authorization Code + PKCE):
   *  1. oauthService.authorize(config, providerId) → tokens
   *  2. POST /api/auth/validate-token with { idToken } → { data: Session }
   *
   * Returns the server-validated Session plus the refresh token to keep.
   */
  async function authenticateWithSso(_tenantId: string, providerId: string): Promise<SignInResult> {
    const tokens = await oauthService.authorize(oauthConfig(), providerId)
    return { session: await validate(tokens.idToken), refresh: refreshOf(tokens, 'sso') }
  }

  /**
   * Renews a session without user interaction:
   *  1. POST /api/auth/select-tenant for the session's email + tenant. Required:
   *     a refresh fires the Pre-Token trigger as TokenGeneration_RefreshTokens,
   *     which resolves the tenant from a live AuthSession (10-min TTL) — without
   *     one, a multi-tenant user's refresh is refused (see pre-token.ts).
   *  2. Exchange the refresh token through the channel that issued it.
   *  3. POST /api/auth/validate-token → the new Session.
   *
   * Returns the new session and the refresh token to keep — the rotated one if
   * Cognito issued one, else the same one. Rejects with whatever failed; use
   * isRefreshRejected() to tell "sign in again" from "try again later".
   */
  async function refreshSession(session: Session, stored: StoredRefresh): Promise<SignInResult> {
    await selectTenant(session.email, session.tenantId)
    const tokens =
      stored.kind === 'sso'
        ? await oauthService.refresh(oauthConfig(), stored.refreshToken)
        : await cognitoService.refresh(stored.refreshToken, cognito.userPoolId, cognito.clientId)
    return {
      session: await validate(tokens.idToken),
      refresh: refreshOf(tokens, stored.kind) ?? stored,
    }
  }

  /** Revokes the refresh token at Cognito (sign-out). Rejects on failure — best-effort for callers. */
  async function revokeRefreshToken(stored: StoredRefresh): Promise<void> {
    await cognitoService.revoke(stored.refreshToken, cognito.userPoolId, cognito.clientId)
  }

  return {
    authenticate,
    authenticateWithSso,
    resolveTenants,
    selectTenant,
    refreshSession,
    revokeRefreshToken,
  }
}
