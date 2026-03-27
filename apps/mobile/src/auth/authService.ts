import { AuthError, MobileConfig, Session } from './types'

type CognitoService = {
  signIn(email: string, password: string, poolId: string, clientId: string): Promise<{ idToken: string }>
}

type AuthServiceDeps = {
  apiBaseUrl: string
  cognitoService: CognitoService
}

/**
 * Creates an authService instance with injected dependencies.
 *
 * Usage (production):
 *   import * as cognitoService from './cognitoService'
 *   const authService = createAuthService({
 *     apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
 *     cognitoService,
 *   })
 *
 * The factory pattern enables tests to inject a mock cognitoService without
 * jest.mock() module patching (D-05). apiBaseUrl is never read from env vars
 * inside the function bodies (D-06).
 */
export function createAuthService({ apiBaseUrl, cognitoService }: AuthServiceDeps) {
  /**
   * Fetches the Cognito user pool ID and mobile client ID for the given tenant.
   * Calls GET /api/auth/mobile-config?tenantId=<id>.
   * Rejects with AuthError('ConfigFetchFailed') on non-2xx response.
   */
  async function fetchMobileConfig(tenantId: string): Promise<MobileConfig> {
    const res = await fetch(
      `${apiBaseUrl}/api/auth/mobile-config?tenantId=${encodeURIComponent(tenantId)}`,
    )
    if (!res.ok) {
      throw new AuthError('ConfigFetchFailed', `mobile-config returned ${res.status}`)
    }
    const body = (await res.json()) as { data: MobileConfig }
    return body.data
  }

  /**
   * Authenticates the driver via three sequential steps:
   *  1. fetchMobileConfig(tenantId) → { userPoolId, clientId }
   *  2. cognitoService.signIn(email, password, userPoolId, clientId) → { idToken }
   *  3. POST /api/auth/validate-token with { token: idToken } → { data: Session }
   *
   * Returns the server-validated Session. The raw idToken is discarded after
   * step 3 — it is never attached to the returned Session (AUTH-03, D-07).
   *
   * Rejects with AuthError on any failure in any step.
   */
  async function authenticate(
    email: string,
    password: string,
    tenantId: string,
  ): Promise<Session> {
    const config = await fetchMobileConfig(tenantId)

    const { idToken } = await cognitoService.signIn(
      email,
      password,
      config.userPoolId,
      config.clientId,
    )

    const res = await fetch(`${apiBaseUrl}/api/auth/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: idToken }),
    })

    if (!res.ok) {
      throw new AuthError('ValidateTokenFailed', `validate-token returned ${res.status}`)
    }

    const body = (await res.json()) as { data: Session }
    return body.data
    // idToken is NOT stored or returned — raw Cognito token ends here (AUTH-03)
  }

  return { fetchMobileConfig, authenticate }
}
