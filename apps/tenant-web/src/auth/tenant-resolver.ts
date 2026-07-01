// ---------------------------------------------------------------------------
// Tenant resolver — backend API calls for the login flow.
//
// The login UI resolves which tenant(s) a user belongs to before any session
// exists. Resolution is keyed off the user's tenant_users roster membership.
//
// These endpoints are public — no session or bearer token required.
// Sensitive configuration (client secrets, SAML certificates) is never
// returned here; only display metadata needed to build the authorize URL.
// ---------------------------------------------------------------------------

import { normalizeEmail } from '@pegasus/auth'
import { apiFetch } from '@/api/client'

export type ProviderType = 'oidc' | 'saml'

export type TenantProvider = {
  /**
   * Stable provider identifier that must exactly match the Cognito identity
   * provider name registered in the User Pool. Used as the `identity_provider`
   * hint in the /oauth2/authorize request.
   */
  id: string
  /** Human-readable name shown in the provider-selection UI. */
  name: string
  /** Protocol type — drives icons and the Phase 3 config form fields. */
  type: ProviderType
}

export type TenantResolution = {
  tenantId: string
  tenantName: string
  /**
   * When true, Cognito built-in email+password login is available.
   * When false, only configured SSO providers may be used.
   */
  cognitoAuthEnabled: boolean
  /** Configured SSO providers. Empty array means no external SSO is configured. */
  providers: TenantProvider[]
}

/**
 * Returns all tenants the given email is invited to.
 *
 * Calls POST /api/auth/resolve-tenants. Returns an empty array when the email
 * is not associated with any active tenant (rather than throwing). Any
 * unexpected server/network error is rethrown so the caller can show a
 * generic error message.
 *
 * @param email - The full email address, e.g. "user@acme.com".
 */
export async function resolveTenantsForEmail(email: string): Promise<TenantResolution[]> {
  return apiFetch<TenantResolution[]>('/api/auth/resolve-tenants', {
    method: 'POST',
    body: JSON.stringify({ email: normalizeEmail(email) }),
  })
}

/**
 * Records the user's tenant selection server-side and returns the tenant's
 * auth configuration (providers, cognitoAuthEnabled).
 *
 * Calls POST /api/auth/select-tenant. Creates a short-lived AuthSession that
 * the pre-token Lambda reads during Cognito authentication.
 *
 * @param email    - The full email address of the authenticating user.
 * @param tenantId - The ID of the tenant the user selected.
 */
export async function selectTenant(email: string, tenantId: string): Promise<TenantResolution> {
  return apiFetch<TenantResolution>('/api/auth/select-tenant', {
    method: 'POST',
    body: JSON.stringify({ email: normalizeEmail(email), tenantId }),
  })
}
