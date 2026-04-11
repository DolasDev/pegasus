// ---------------------------------------------------------------------------
// Session — app-specific sessionStorage utilities for tenant-web.
//
// The base Session type comes from @pegasus/auth. Tenant-web extends it
// with a `token` field for the Cognito ID token used to authenticate API
// requests.
// ---------------------------------------------------------------------------

import { type Session as BaseSession, isSessionExpired } from '@pegasus/auth'

export { isSessionExpired }

const SESSION_KEY = 'pegasus.session'

/**
 * Tenant-web session extends the shared Session with the raw Cognito ID token.
 */
export type Session = BaseSession & {
  /** Narrows role to the tenant-specific union. */
  role: 'tenant_admin' | 'tenant_user'
  /** The Cognito ID token used to authenticate API requests. */
  token: string
}

/** Returns the current session from sessionStorage, or null if absent/expired. */
export function getSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Session
    if (isSessionExpired(parsed)) {
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
