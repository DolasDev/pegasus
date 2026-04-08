/** Typed error carrying the Cognito error code (e.g. NotAuthorizedException). */
export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
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

export type ProviderType = 'oidc' | 'saml'

/**
 * SSO provider entry returned by the resolve-tenants and select-tenant endpoints.
 * The `id` field must exactly match the Cognito identity provider name registered
 * in the User Pool — it is passed as the `identity_provider` hint in the OAuth
 * authorize URL.
 */
export type TenantProvider = {
  id: string
  name: string
  type: ProviderType
}

/**
 * Tenant entry returned by POST /api/auth/resolve-tenants and POST /api/auth/select-tenant.
 * Includes SSO providers so the mobile app can show provider selection buttons.
 */
export type TenantResolution = {
  tenantId: string
  tenantName: string
  cognitoAuthEnabled: boolean
  providers: TenantProvider[]
}
