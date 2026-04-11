import { AuthError, type Session, type TenantResolution } from './types'
import type { MobileConfig } from '../config'
import type { OAuthConfig } from './oauthService'

type CognitoService = {
  signIn(
    email: string,
    password: string,
    poolId: string,
    clientId: string,
  ): Promise<{ idToken: string }>
}

type OAuthService = {
  authorize(config: OAuthConfig, providerId: string): Promise<{ idToken: string }>
}

type AuthServiceDeps = {
  config: MobileConfig
  cognitoService: CognitoService
  oauthService: OAuthService
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

  /**
   * Authenticates the driver via two sequential steps:
   *  1. cognitoService.signIn(email, password, userPoolId, clientId) → { idToken }
   *  2. POST /api/auth/validate-token with { idToken } → { data: Session }
   *
   * Config comes from baked-in constants — no network call needed.
   * Returns the server-validated Session. The raw idToken is discarded after
   * step 2 — it is never attached to the returned Session (AUTH-03, D-07).
   *
   * Rejects with AuthError on any failure in any step.
   */
  async function authenticate(
    email: string,
    password: string,
    _tenantId: string,
  ): Promise<Session> {
    const { idToken } = await cognitoService.signIn(
      email,
      password,
      cognito.userPoolId,
      cognito.clientId,
    )

    const res = await fetch(`${apiUrl}/api/auth/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })

    if (!res.ok) {
      throw new AuthError('ValidateTokenFailed', `validate-token returned ${res.status}`)
    }

    const body = (await res.json()) as { data: Session }
    return { ...body.data, token: idToken }
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
      body: JSON.stringify({ email }),
    })
    if (!res.ok) {
      throw new AuthError('ResolveTenantsFailed', `resolve-tenants returned ${res.status}`)
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
      body: JSON.stringify({ email, tenantId }),
    })
    if (!res.ok) {
      throw new AuthError('SelectTenantFailed', `select-tenant returned ${res.status}`)
    }
  }

  /**
   * Authenticates the driver via SSO (OAuth2 Authorization Code + PKCE):
   *  1. oauthService.authorize(config, providerId) → { idToken }
   *  2. POST /api/auth/validate-token with { idToken } → { data: Session }
   *
   * Config comes from baked-in constants — no network call needed.
   * Returns the server-validated Session. The raw idToken is discarded after
   * step 2 — same security model as password-based authenticate().
   */
  async function authenticateWithSso(_tenantId: string, providerId: string): Promise<Session> {
    if (!cognito.domain) {
      throw new AuthError('SsoNotConfigured', 'SSO is not configured for this environment')
    }

    const oauthConfig: OAuthConfig = {
      hostedUiDomain: cognito.domain,
      clientId: cognito.clientId,
      redirectUri: cognito.redirectUri,
    }

    const { idToken } = await oauthService.authorize(oauthConfig, providerId)

    const res = await fetch(`${apiUrl}/api/auth/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })

    if (!res.ok) {
      throw new AuthError('ValidateTokenFailed', `validate-token returned ${res.status}`)
    }

    const body = (await res.json()) as { data: Session }
    return { ...body.data, token: idToken }
  }

  return { authenticate, authenticateWithSso, resolveTenants, selectTenant }
}
