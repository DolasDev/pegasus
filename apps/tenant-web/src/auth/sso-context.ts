// ---------------------------------------------------------------------------
// SSO context — what the login form knew, carried across the IdP round-trip.
//
// A federated login leaves the SPA entirely (full-page redirect to the Hosted
// UI, then to the IdP, then back to /login/callback), so React state is gone by
// the time we return. The callback needs three facts the login form had and the
// callback URL does not carry:
//
//   - which email the user typed      → to say "you asked for X, you got Y"
//   - which tenant + provider they picked → to look up the IdP's sign-out URL
//
// It is deliberately NOT part of the PKCE state: that is a single-use CSRF
// credential consumed on the first read (see pkce.ts), whereas this survives to
// drive the recovery flow, which itself redirects away and comes back.
//
// sessionStorage, not localStorage — this is per-tab login scratch, and it must
// not outlive the browser session or leak into other tabs' logins.
// ---------------------------------------------------------------------------

const SSO_CONTEXT_KEY = 'pegasus.sso.context'

export type SsoContext = {
  /** The email the user typed on the login form (normalized). */
  email: string
  tenantId: string
  /** Cognito identity provider name — matches TenantSsoProvider.cognitoProviderName. */
  providerId: string
  /** Human-readable provider name, for error copy ("sign out of Acme Okta"). */
  providerName: string
}

/** Records what the login form knew, immediately before redirecting to the IdP. */
export function saveSsoContext(context: SsoContext): void {
  sessionStorage.setItem(SSO_CONTEXT_KEY, JSON.stringify(context))
}

/**
 * Reads the stored SSO context, or null when there is none.
 *
 * Does NOT clear it: the recovery flow reads it on the callback page, redirects
 * to Cognito's /logout, and reads it again on the way back at
 * /login/signed-out. Clearing happens explicitly via clearSsoContext() once the
 * flow terminates.
 *
 * Anything unparseable or structurally wrong returns null rather than throwing —
 * this only ever drives an error-recovery affordance, and a failure to read it
 * must degrade to "no recovery offered", never to a crashed callback page.
 */
export function readSsoContext(): SsoContext | null {
  const raw = sessionStorage.getItem(SSO_CONTEXT_KEY)
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const { email, tenantId, providerId, providerName } = parsed as Record<string, unknown>

  if (
    typeof email !== 'string' ||
    typeof tenantId !== 'string' ||
    typeof providerId !== 'string' ||
    typeof providerName !== 'string'
  ) {
    return null
  }

  return { email, tenantId, providerId, providerName }
}

export function clearSsoContext(): void {
  sessionStorage.removeItem(SSO_CONTEXT_KEY)
}
