// ---------------------------------------------------------------------------
// Why a password reset was refused — the message, not the diagnosis.
//
// Cognito refuses ForgotPassword with either NotAuthorizedException or
// InvalidParameterException in several unrelated situations, and does not tell
// us which one applies. Two matter here:
//
//   1. The account is federated — it signs in through an SSO provider and has
//      no Cognito password to reset.
//   2. The account is still on an unredeemed invitation (FORCE_CHANGE_PASSWORD),
//      typically because the temporary password expired after 7 days.
//
// The login page used to name (1) unconditionally. For case (2) — the whole
// reason POST /users/:id/resend-invite exists — that told an invitee they were
// an SSO user, which is false and sends them down a support path that dead-ends.
//
// We do not guess from the exception code, and we deliberately do not ask the
// API which case it is: POST /api/auth/resolve-tenants is public and
// unauthenticated, so reporting per-account Cognito state there would make it a
// user-enumeration oracle. Instead we narrow using only what that endpoint
// already returns publicly — whether the tenants behind this address have any
// SSO provider configured at all. When none do, explanation (1) is impossible
// and we can speak plainly. When some do, we say both, because both remain
// possible and a hedge that is true beats a specific claim that is false.
// ---------------------------------------------------------------------------

import type { TenantResolution } from './tenant-resolver'

/** Shown when the address matches no tenant, or resolution itself failed. */
export const FORGOT_REFUSED_GENERIC =
  'We couldn’t start a password reset for that email. Check the address, or contact your administrator.'

/** Shown when no tenant behind this address has SSO — so an unredeemed or
 *  expired invitation is the remaining explanation. */
export const FORGOT_REFUSED_INVITE =
  'We couldn’t start a password reset for that email. If you were recently invited, your temporary password may have expired — ask your administrator to resend your invitation.'

/** Shown when at least one tenant has SSO configured, so either explanation
 *  is still possible. */
export const FORGOT_REFUSED_INVITE_OR_SSO =
  'We couldn’t start a password reset for that email. If you sign in through your organization’s identity provider, use that instead — there is no separate password to reset. If you were recently invited, your temporary password may have expired; ask your administrator to resend your invitation.'

/**
 * Picks the refusal message for an email whose ForgotPassword call was rejected.
 *
 * @param tenants Result of `resolveTenantsForEmail` for the address the user
 *                typed — which may differ from the one they were signing in
 *                with, since the reset form has its own email field. Pass an
 *                empty array if resolution failed; the generic message is the
 *                safe fallback.
 */
export function forgotRefusalMessage(tenants: TenantResolution[]): string {
  if (tenants.length === 0) return FORGOT_REFUSED_GENERIC
  const anySso = tenants.some((t) => t.providers.length > 0)
  return anySso ? FORGOT_REFUSED_INVITE_OR_SSO : FORGOT_REFUSED_INVITE
}
