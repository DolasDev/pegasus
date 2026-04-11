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
  /** The user's role within their tenant. */
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
