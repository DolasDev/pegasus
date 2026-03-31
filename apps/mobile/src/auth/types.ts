/** Typed error carrying the Cognito error code (e.g. NotAuthorizedException). */
export class AuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = code
  }
}

/**
 * Server-validated session returned from authService.authenticate.
 * Raw Cognito ID token is NOT included — it is discarded after validate-token succeeds.
 */
export type Session = {
  sub: string
  tenantId: string
  role: string
  email: string
  expiresAt: number
  ssoProvider: string | null
}

/**
 * Cognito pool credentials returned by GET /api/auth/mobile-config.
 * Fetched at runtime after tenant selection — never baked into the app bundle.
 */
export type MobileConfig = {
  userPoolId: string
  clientId: string
}

/**
 * Tenant entry returned by POST /api/auth/resolve-tenants and POST /api/auth/select-tenant.
 * Mobile code uses tenantId and tenantName; cognitoAuthEnabled retained for completeness.
 */
export type TenantResolution = {
  tenantId: string
  tenantName: string
  cognitoAuthEnabled: boolean
}
