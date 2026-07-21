// ---------------------------------------------------------------------------
// IdP sign-out — recovery when the browser authenticated as the wrong account.
//
// An IdP with a cached browser session signs the user in as whoever it already
// has, so a user who typed a@acme.com but is signed in to Microsoft as
// b@acme.com gets authenticated as b — and retrying does exactly the same thing,
// forever. The only way out is to end the session at the IdP.
//
// That takes TWO sign-outs, and Cognito's own /logout is explicitly not enough:
//   "The logout endpoint doesn't sign users out of OIDC or social identity
//    providers (IdPs)."
//   https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html
//
// So the flow is a chain, deliberately Cognito-FIRST:
//
//   /login/callback  ──▶ Cognito /logout?logout_uri=<origin>/login/signed-out
//                              │
//                        (Cognito session cleared)
//                              ▼
//   /login/signed-out ──▶ IdP end_session_endpoint?post_logout_redirect_uri=<origin>/login
//                              │
//                        (IdP session cleared)
//                              ▼
//                          /login  — user starts over, IdP now asks who they are
//
// Order matters. The IdP's post_logout_redirect_uri must be registered in the
// CUSTOMER's app registration, which we do not control — if it is not, the IdP
// shows its own "you are signed out" page and the chain stops there. Ending on
// that page with both sessions cleared is a fine outcome. Doing it the other way
// round would strand the user at the IdP with the Cognito session still live,
// which is the one ordering that leaves them worse off than before.
// ---------------------------------------------------------------------------

import { apiFetch } from '@/api/client'
import { getCognitoConfig, type CognitoConfig } from '@/auth/cognito'

/** Where Cognito returns to after clearing its own session. Must be registered
 *  as a sign-out URL on the tenant app client (packages/infra cognito-stack). */
export const SIGNED_OUT_PATH = '/login/signed-out'

const PENDING_IDP_SIGNOUT_KEY = 'pegasus.sso.pendingIdpSignOut'

/**
 * Asks the backend for the IdP's OIDC end-session endpoint.
 *
 * Returns null for SAML providers, providers that publish no end_session_endpoint,
 * and any failure — the endpoint is designed never to error, and a null here just
 * means the user has to sign out of their IdP by hand.
 */
export async function fetchIdpSignOutUrl(
  tenantId: string,
  providerId: string,
): Promise<string | null> {
  try {
    const { signOutUrl } = await apiFetch<{ signOutUrl: string | null }>(
      '/api/auth/idp-sign-out-url',
      { method: 'POST', body: JSON.stringify({ tenantId, providerId }) },
    )
    return signOutUrl
  } catch {
    return null
  }
}

export function buildCognitoLogoutUrl(config: CognitoConfig, returnPath: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: `${window.location.origin}${returnPath}`,
  })
  return `${config.domain}/logout?${params.toString()}`
}

/**
 * Starts the chain: stashes the IdP sign-out URL for the second leg, then
 * navigates to Cognito's /logout.
 *
 * Resolving the IdP URL BEFORE leaving the SPA is deliberate — /login/signed-out
 * is reached by a full-page redirect from Cognito, and having it do its own
 * fetch would put a second network round-trip (and a second failure mode) in the
 * middle of a redirect chain the user is already watching.
 */
export async function startIdpSignOut(tenantId: string, providerId: string): Promise<void> {
  const idpSignOutUrl = await fetchIdpSignOutUrl(tenantId, providerId)
  if (idpSignOutUrl) {
    sessionStorage.setItem(PENDING_IDP_SIGNOUT_KEY, idpSignOutUrl)
  } else {
    sessionStorage.removeItem(PENDING_IDP_SIGNOUT_KEY)
  }

  window.location.href = buildCognitoLogoutUrl(getCognitoConfig(), SIGNED_OUT_PATH)
}

/** Reads and clears the IdP sign-out URL stashed by startIdpSignOut. */
export function consumePendingIdpSignOut(): string | null {
  const url = sessionStorage.getItem(PENDING_IDP_SIGNOUT_KEY)
  sessionStorage.removeItem(PENDING_IDP_SIGNOUT_KEY)

  // Only ever navigate to an https URL. This value came from the backend, which
  // already filters the discovery document to https — belt and braces, because
  // the sink here is a top-level navigation.
  return url && url.startsWith('https://') ? url : null
}

/** Appends our post-logout return address to the IdP's end-session endpoint. */
export function buildIdpSignOutUrl(endSessionEndpoint: string, returnPath = '/login'): string {
  const url = new URL(endSessionEndpoint)
  url.searchParams.set('post_logout_redirect_uri', `${window.location.origin}${returnPath}`)
  return url.toString()
}
