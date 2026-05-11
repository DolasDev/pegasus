// ---------------------------------------------------------------------------
// Session — shared session type used across Pegasus frontends.
//
// Storage (sessionStorage, SecureStore, etc.) is app-specific and NOT
// included here. This module only defines the shape and pure utilities.
// ---------------------------------------------------------------------------

/**
 * An authenticated Pegasus session.
 *
 * Identity is keyed on `sub` (Cognito user identifier) + `tenantId`.
 * Never rely on `email` alone for identity — it can change.
 */
export type Session = {
  /** Cognito user identifier (`sub` claim). Stable — never changes. */
  sub: string
  /** Tenant the user belongs to. */
  tenantId: string
  /** Display name of the tenant (e.g. "Acme Moving Co"). Display only. */
  tenantName: string
  /**
   * Cedar role-group memberships. Authoritative source for permission gating.
   * The pre-token Lambda emits this as `custom:roles`; `/api/auth/validate-token`
   * surfaces it here.
   */
  roleNames: string[]
  /**
   * Coarse-grained role string. Derived from `roleNames` (set to `tenant_admin`
   * when `roleNames` includes it, otherwise the first roleName). Kept for
   * backward compatibility with display-only consumers (e.g. the mobile
   * `UserMenuButton`). New permission gating MUST read `roleNames` instead.
   */
  role: string
  /** User's email address. Display only — not an identity key. */
  email: string
  /** Session expiry as Unix epoch seconds. */
  expiresAt: number
  /** The SSO provider identifier, or null for direct Cognito logins. */
  ssoProvider: string | null
}

/** Returns true if the session has expired (expiresAt <= now). */
export function isSessionExpired(session: Session): boolean {
  return session.expiresAt <= Math.floor(Date.now() / 1000)
}
