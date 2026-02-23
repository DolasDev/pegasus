// ---------------------------------------------------------------------------
// Tenant resolver — Phase 2: real backend API call.
//
// Replaces the Phase 1 mock (hardcoded domain table).
// The login UI is unchanged — it calls resolveTenantByDomain() and knows
// nothing about the underlying implementation.
//
// Backend endpoint: POST /api/auth/resolve-tenant
//   Body:    { domain: string }
//   Success: { data: TenantResolution }
//   404:     { error: string, code: "TENANT_NOT_FOUND" }
//   400:     { error: string, code: "VALIDATION_ERROR" }
//
// This endpoint is public — no session or bearer token required.
// Sensitive configuration (client secrets, SAML certificates) is never
// returned here; only display metadata needed to build the authorize URL.
// ---------------------------------------------------------------------------

import { apiFetch, ApiError } from '@/api/client'

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
  /** Configured SSO providers. Empty array means SSO is not yet set up. */
  providers: TenantProvider[]
}

/**
 * Resolves the tenant and its configured SSO providers for a given email domain.
 *
 * @param domain - The email domain, e.g. "acme.com" (not the full address).
 * @returns The tenant resolution, or null if the domain is unrecognised.
 */
export async function resolveTenantByDomain(domain: string): Promise<TenantResolution | null> {
  try {
    return await apiFetch<TenantResolution>('/api/auth/resolve-tenant', {
      method: 'POST',
      body: JSON.stringify({ domain: domain.toLowerCase() }),
    })
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // Unrecognised domain — not an error condition, just an unknown tenant.
      return null
    }
    // Re-throw unexpected errors (network failure, 500, etc.) so the login
    // UI can surface them as a generic error rather than "domain not found".
    throw err
  }
}
