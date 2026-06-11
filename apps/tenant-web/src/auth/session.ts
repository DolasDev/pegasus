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

// ---------------------------------------------------------------------------
// E2E auth seam — BUILD-TIME ONLY, never enabled in deployed bundles.
//
// When the bundle is built with `vite build --mode e2e` (the CI e2e job and
// local browser-spec runs — see apps/e2e/README.md), `getSession()` returns a
// synthetic tenant_admin session instead of reading sessionStorage. This lets
// Playwright browser specs pass the route auth guards without a Cognito login;
// the API behind them runs with SKIP_AUTH=true and ignores the bearer token,
// so the synthetic token is never validated anywhere.
//
// Why `MODE` and not a `VITE_E2E_SKIP_AUTH` env var: `import.meta.env.MODE`
// is statically replaced by Vite at build time, so in a production build
// (mode "production") the comparison below is constant-false and the whole
// branch — including the synthetic session — is dead-code-eliminated from the
// bundle. Accesses to *unset* VITE_* vars, by contrast, survive as runtime
// property lookups and are NOT eliminated (verified empirically). A mode also
// can't leak in via a stray environment variable: it must be passed explicitly
// on the build command line. Verified by grepping dist/ for `e2e-skip-auth`
// after a prod build (must be absent).
// ---------------------------------------------------------------------------
const E2E_SKIP_AUTH: boolean = import.meta.env.MODE === 'e2e'

function syntheticE2eSession(): Session {
  return {
    sub: 'e2e-skip-auth-user',
    tenantId: 'e2e00000-0000-0000-0000-000000000001',
    tenantName: 'E2E Test Tenant',
    roleNames: ['tenant_admin'],
    role: 'tenant_admin',
    email: 'e2e-admin@example.com',
    // Far-future expiry — the seam session never expires mid-run.
    expiresAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    ssoProvider: null,
    token: 'e2e-skip-auth-token',
  }
}

/**
 * Tenant-web session extends the shared Session with the raw Cognito ID token.
 */
export type Session = BaseSession & {
  /** Coarse-grained role string carried from the base Session. Authoritative
   *  permission gating MUST read `roleNames` — this is display-only and may
   *  hold any value from the role catalog (tenant_admin, viewer, sales, …). */
  role: string
  /** The Cognito ID token used to authenticate API requests. */
  token: string
}

/** Returns the current session from sessionStorage, or null if absent/expired. */
export function getSession(): Session | null {
  if (E2E_SKIP_AUTH) {
    return syntheticE2eSession()
  }
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
