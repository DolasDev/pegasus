// ---------------------------------------------------------------------------
// SSO failure markers — a wire contract between the Cognito pre-token Lambda
// and the tenant web app's login callback.
//
// When a Lambda trigger throws, Cognito redirects to the app's callback URL with
// the message embedded in `error_description`. That is the ONLY channel from a
// rejected federated sign-in back to the SPA — no token is issued, so there is
// nothing else to inspect.
//
// AWS explicitly documents that error descriptions are not fixed strings and
// must not be pattern-matched:
//   https://docs.aws.amazon.com/cognito/latest/developerguide/federation-endpoint-idp-responses.html
// Cognito wraps our message in its own prose ("PreTokenGeneration failed with
// error <message>. (Service: …; Status Code: 400; …)"), and that wrapper is free
// to change. So we embed a marker of our OWN in the message and substring-match
// only that — never the surrounding text, never its position.
//
// Lives in @pegasus/domain because it is the one zero-dependency package both
// apps/api and apps/tenant-web already depend on; it needs no new dependency
// edge in either direction. It is a constant and a string search — no runtime
// dependencies, consistent with the rest of this package.
// ---------------------------------------------------------------------------

/**
 * The IdP completed authentication but asserted no email address at all.
 *
 * Typically an account with no mail attribute populated on the IdP side (e.g.
 * an Entra ID user without a mailbox). Often — but not always — a sign of the
 * user having a DIFFERENT account cached at the IdP than the one they asked for,
 * so the recovery path is the same: sign out of the IdP and retry.
 */
export const SSO_ERROR_NO_EMAIL = 'PEGASUS_IDP_NO_EMAIL'

/**
 * The IdP asserted an email that has no roster row in the provider's tenant.
 *
 * Pegasus is strictly invite-only, so this is either a genuinely uninvited user
 * or — the common case — someone whose browser was signed in to the IdP as a
 * different account than the one they typed on the login form.
 */
export const SSO_ERROR_NOT_ROSTERED = 'PEGASUS_IDP_NOT_ROSTERED'

export const SSO_ERROR_MARKERS = [SSO_ERROR_NO_EMAIL, SSO_ERROR_NOT_ROSTERED] as const

export type SsoErrorMarker = (typeof SSO_ERROR_MARKERS)[number]

/**
 * Returns the marker embedded in a Cognito `error_description`, or null when it
 * carries none (an unrelated failure, which the caller should surface verbatim).
 *
 * Substring match by design — see the module comment. Callers must not assume
 * anything about where in the description the marker appears.
 */
export function findSsoErrorMarker(
  errorDescription: string | null | undefined,
): SsoErrorMarker | null {
  if (!errorDescription) return null
  return SSO_ERROR_MARKERS.find((marker) => errorDescription.includes(marker)) ?? null
}
