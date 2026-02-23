// ---------------------------------------------------------------------------
// Session — type definition and sessionStorage utilities
//
// The Session shape is the single source of truth for what an authenticated
// session looks like across ALL phases of the SSO implementation.
//
// Phase 1: values are populated from mock data in login.callback.tsx.
// Phase 2: values are derived from the validated Cognito ID token claims:
//   sub          → token.sub
//   tenantId     → token["custom:tenantId"]
//   role         → token["custom:role"]
//   email        → token.email
//   expiresAt    → token.exp
//   ssoProvider  → identity_provider hint used during the auth flow
//
// Storage rationale (Phase 1):
//   sessionStorage is used — it is cleared when the browser tab closes,
//   limiting the window of exposure vs localStorage. In Phase 2, if the
//   existing architecture allows a backend session endpoint, tokens will
//   be stored in httpOnly cookies via that endpoint and sessionStorage
//   will hold only non-sensitive display metadata. That decision is
//   documented in Phase 2.
// ---------------------------------------------------------------------------

const SESSION_KEY = 'pegasus.session'

/**
 * An authenticated Pegasus session.
 *
 * Identity is keyed on `sub` (Cognito user identifier) + `tenantId`.
 * Never rely on `email` alone for identity — it can change.
 */
export type Session = {
  /** Cognito user identifier (`sub` claim). Stable — never changes. */
  sub: string
  /** Tenant the user belongs to (`custom:tenantId` claim in Phase 2). */
  tenantId: string
  /** The user's role within their tenant (`custom:role` claim in Phase 2). */
  role: 'tenant_admin' | 'tenant_user'
  /** User's email address (`email` claim). Display only — not an identity key. */
  email: string
  /** Session expiry as Unix epoch seconds (`exp` claim in Phase 2). */
  expiresAt: number
  /**
   * The SSO provider identifier used to authenticate this session.
   * Corresponds to the Cognito identity provider name in Phase 2.
   * Null for direct (non-SSO) Cognito logins.
   */
  ssoProvider: string | null
  /** The Cognito ID token used to authenticate API requests (added in Phase 5). */
  token: string
}

/** Returns the current session from sessionStorage, or null if absent/expired. */
export function getSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Session
    // Discard expired sessions (expiresAt is Unix epoch seconds)
    if (parsed.expiresAt < Math.floor(Date.now() / 1000)) {
      clearSession()
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** Persists a session to sessionStorage. */
export function setSession(session: Session): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

/** Removes the session from sessionStorage. */
export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY)
}
