// ---------------------------------------------------------------------------
// Shared Cognito helpers for admin handlers
//
// Both the tenant provisioning handler and the tenant-user management handler
// need to call Cognito. This module provides a lazy singleton client and a few
// idempotent helpers so the call-site logic stays simple.
//
// NEVER address a Cognito user by email (`Username: email`). The pool was
// created with the legacy case-SENSITIVE sign-in (UsernameConfiguration unset,
// immutable per pool), and a user's `email` attribute does not stay in the
// lowercase form we invite with: when an SSO identity is linked to the native
// user, Cognito copies the IdP-asserted email onto it (`AttributeMapping:
// { email: 'email' }` in handlers/sso.ts) on EVERY federated sign-in — e.g.
// Entra asserts `TimStrey@…` — and resets email_verified to false. From then on
// `AdminGetUser`/`AdminResetUserPassword` with the lowercase email report
// UserNotFound, and `AdminCreateUser` with it happily mints a SECOND user.
// Verified against prod 2026-09-15 (5 of 30 users drifted; one duplicate).
//
// So every lookup goes through findCognitoUsersByEmail (ListUsers, whose
// `email =` filter IS case-insensitive — `spobuta@…` returned `SPobuta@…` in
// prod), and every Admin* call after it uses the returned UUID `Username` — except
// the temporary-password RESEND, which uses the email exactly as currently stored
// (see resendTemporaryPassword).
// ---------------------------------------------------------------------------

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminResetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  ListUsersCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider'
import { escapeFilterValue } from '../../cognito/list-users-filter'

// ---------------------------------------------------------------------------
// Cognito client — lazy singleton reused across warm Lambda invocations.
// Region is resolved automatically from the Lambda execution environment.
// ---------------------------------------------------------------------------
let _cognito: CognitoIdentityProviderClient | null = null
export function getCognito(): CognitoIdentityProviderClient {
  return (_cognito ??= new CognitoIdentityProviderClient({}))
}

function userPoolId(): string {
  return process.env['COGNITO_USER_POOL_ID'] ?? ''
}

export interface ProvisionTenantContext {
  tenantId: string
  tenantName: string
  tenantSlug: string
}

function tenantMetadata(tenant: ProvisionTenantContext): Record<string, string> {
  return {
    source: 'tenant',
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
    tenantSlug: tenant.tenantSlug,
  }
}

function emailOf(user: UserType): string | undefined {
  return user.Attributes?.find((a) => a.Name === 'email')?.Value
}

/**
 * Thrown when more than one native (non-federated) Cognito user holds the same
 * email, ignoring case. The pool should never contain that — it is the duplicate
 * this module exists to prevent — and acting on an arbitrary one of them would
 * reset or re-invite the wrong account, so callers fail loudly instead.
 */
export class DuplicateCognitoUserError extends Error {
  override name = 'DuplicateCognitoUserError'
  constructor(readonly count: number) {
    super(`${count} native Cognito users share this email (case-insensitive)`)
  }
}

export interface CognitoUsersForEmail {
  /** The password-capable user (UUID Username), if one exists. */
  native: (UserType & { Username: string }) | null
  /** Unlinked federated users (UserStatus EXTERNAL_PROVIDER) asserting this email. */
  federated: UserType[]
}

/**
 * Finds every Cognito user whose `email` attribute equals `email`, ignoring case.
 *
 * The filter's case-insensitivity is observed behavior, not documented, so the
 * results are re-compared lowercased on both sides (the same guard as
 * cognito/pre-sign-up.ts): a case-insensitive filter returning `Tim@…` for
 * `tim@…` is the same person, and anything else is dropped.
 */
export async function findCognitoUsersByEmail(email: string): Promise<CognitoUsersForEmail> {
  const normalized = email.trim().toLowerCase()
  const listed = await getCognito().send(
    new ListUsersCommand({
      UserPoolId: userPoolId(),
      Filter: `email = "${escapeFilterValue(normalized)}"`,
      Limit: 10,
    }),
  )

  const matches = (listed.Users ?? []).filter((u) => emailOf(u)?.toLowerCase() === normalized)
  const natives = matches.filter(
    (u): u is UserType & { Username: string } =>
      u.UserStatus !== 'EXTERNAL_PROVIDER' && typeof u.Username === 'string',
  )
  if (natives.length > 1) throw new DuplicateCognitoUserError(natives.length)

  return {
    native: natives[0] ?? null,
    federated: matches.filter((u) => u.UserStatus === 'EXTERNAL_PROVIDER'),
  }
}

async function createCognitoUser(email: string, tenant: ProvisionTenantContext): Promise<void> {
  try {
    await getCognito().send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId(),
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
        ClientMetadata: tenantMetadata(tenant),
        ...(process.env['NODE_ENV'] !== 'production' ? { MessageAction: 'SUPPRESS' as const } : {}),
      }),
    )
  } catch (err) {
    // A concurrent invite for the same address won the race — same outcome.
    if ((err as { name?: string }).name === 'UsernameExistsException') return
    throw err
  }
}

/**
 * Provisions a Cognito user (AdminCreateUser) unless one already exists.
 *
 * The user is created with FORCE_CHANGE_PASSWORD status. Cognito sends the
 * invite email with a temporary password unless the runtime is non-production,
 * in which case the email is suppressed.
 *
 * `tenant` is forwarded to the CustomMessage Lambda trigger via ClientMetadata
 * so the invite email can name the tenant and link to the right login page.
 *
 * Idempotent: an existing native user with this email — in ANY letter case —
 * means there is nothing to create (the shared pool holds one identity per
 * person; tenant membership lives in TenantUser). Checking first is required,
 * not an optimization: relying on UsernameExistsException alone created a
 * duplicate user whenever SSO had re-cased the existing user's email.
 */
export async function provisionCognitoUser(
  email: string,
  tenant: ProvisionTenantContext,
): Promise<void> {
  const { native } = await findCognitoUsersByEmail(email)
  if (native) return
  await createCognitoUser(email, tenant)
}

/**
 * What {@link resetCognitoUserPassword} actually did, for the caller to log.
 *
 * - `reset`     — AdminResetUserPassword: a confirmation code was emailed
 * - `resent`    — the user never set a password (FORCE_CHANGE_PASSWORD — typically
 *                 someone who went straight to SSO), so there is nothing to reset;
 *                 a fresh temporary password was emailed instead
 * - `not_found` — no password-capable Cognito user exists for this email, or the one
 *                 that does is not the identity the tenant's row signed in as
 * - `skipped`   — `resent` would apply, but non-production sends no invite email
 */
export type ResetPasswordOutcome = 'reset' | 'resent' | 'not_found' | 'skipped'

/**
 * Triggers an admin-initiated password reset.
 *
 * AdminResetUserPassword sets the user to RESET_REQUIRED and emails them a
 * confirmation code; the user completes it through the self-service confirm UI
 * (ConfirmForgotPassword) — the admin never handles a temporary secret.
 *
 * Cognito can only deliver that code to a VERIFIED email, and SSO linking leaves
 * the email re-cased and unverified (see the file header). So when the stored
 * email is not exactly the lowercase, verified form, it is restored first. Setting
 * email_verified in the same call keeps Cognito from sending a verification code.
 * The user's next SSO sign-in will re-case it again; that is harmless, because
 * the code has already been sent and no lookup here depends on the case.
 *
 * Throws for Cognito errors and for {@link DuplicateCognitoUserError}.
 */
export async function resetCognitoUserPassword(
  email: string,
  expectedSub: string,
  tenant: ProvisionTenantContext,
): Promise<ResetPasswordOutcome> {
  const normalized = email.trim().toLowerCase()
  const { native } = await findCognitoUsersByEmail(normalized)

  // Only act on the identity the tenant's row actually signed in as. The pool is
  // shared, and a tenant admin can mint an ACTIVE row for an arbitrary address
  // (invite → deactivate → reactivate), so matching by email alone would let
  // tenant A reset — or re-issue a temporary password for — a user who belongs
  // only to tenant B. `cognitoSub` is written solely by a real sign-in into the
  // tenant (cognito/pre-token.ts), which a forged row cannot produce.
  const sub = native?.Attributes?.find((a) => a.Name === 'sub')?.Value
  if (!native || sub !== expectedSub) return 'not_found'

  const verified = native.Attributes?.find((a) => a.Name === 'email_verified')?.Value === 'true'
  if (emailOf(native) !== normalized || !verified) {
    await getCognito().send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId(),
        Username: native.Username,
        UserAttributes: [
          { Name: 'email', Value: normalized },
          { Name: 'email_verified', Value: 'true' },
        ],
      }),
    )
  }

  if (native.UserStatus === 'FORCE_CHANGE_PASSWORD') {
    if (process.env['NODE_ENV'] !== 'production') return 'skipped'
    // The email was restored to `normalized` above, so the alias form matches.
    await resendTemporaryPassword(normalized, tenant)
    return 'resent'
  }

  await getCognito().send(
    new AdminResetUserPasswordCommand({
      UserPoolId: userPoolId(),
      Username: native.Username,
    }),
  )
  return 'reset'
}

/**
 * AdminCreateUser + MessageAction RESEND: regenerates the temporary password and
 * restarts its 7-day clock.
 *
 * `emailAsStored` must be the email EXACTLY as it is currently on the Cognito
 * record — the one exception to "address by UUID Username" in this file. RESEND by
 * email alias is the form proven in prod (2026-09-10); RESEND by UUID is not, so
 * callers pass the stored email rather than the lowercase invite email.
 *
 * `MessageAction` is a single enum value, so RESEND cannot be combined with the
 * SUPPRESS that {@link provisionCognitoUser} uses outside production — callers
 * short-circuit non-production before reaching this.
 *
 * No UserAttributes on a RESEND — the account already carries them. The
 * `intent: 'resend'` metadata lets cognito/custom-message.ts render re-invite
 * wording; without it the recipient gets a body identical to their first invite.
 */
async function resendTemporaryPassword(
  emailAsStored: string,
  tenant: ProvisionTenantContext,
): Promise<void> {
  await getCognito().send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId(),
      Username: emailAsStored,
      MessageAction: 'RESEND',
      ClientMetadata: { ...tenantMetadata(tenant), intent: 'resend' },
    }),
  )
}

/**
 * What {@link resendCognitoInvite} actually did, for the caller to log.
 *
 * - `resent`             — a fresh temporary password was emailed (the expired-invite case)
 * - `created`            — no Cognito account existed at all; one was provisioned
 * - `already_registered` — the identity exists and is past the invite stage.
 *                          Nothing was sent and nothing was mutated; the caller
 *                          turns this into a 422.
 * - `skipped`            — non-production, so no email was sent (see below)
 */
export type ResendInviteOutcome = 'resent' | 'created' | 'already_registered' | 'skipped'

/**
 * Re-issues the invitation for a user who never completed first login.
 *
 * Cognito temporary passwords expire after `tempPasswordValidity` (7 days —
 * `packages/infra/lib/stacks/cognito-stack.ts`). Past that window the invitee
 * cannot sign in, and neither `/users/invite` (409 — the TenantUser row exists)
 * nor `/users/:id/reset-password` (422 — not ACTIVE) will help them. This is the
 * way out.
 *
 * Branches on the user's *state* rather than on Cognito error names, because
 * only one action is legal in each state and guessing at exception strings is
 * how this kind of helper silently rots:
 *
 *   FORCE_CHANGE_PASSWORD → AdminCreateUser + MessageAction RESEND. Regenerates
 *                           the temporary password and restarts the 7-day clock.
 *   (no such user)        → provision from scratch.
 *   anything else         → `already_registered`. No Cognito call at all.
 *
 * That last branch is a security boundary, not tidiness. The user pool is shared
 * across every tenant and keyed by email (see the `handlers/users.ts` header),
 * and a tenant admin may invite an arbitrary address — which mints a PENDING
 * TenantUser row in *their* tenant for someone who may be an active user of a
 * different one. So this helper may only ever mutate an identity that has never
 * completed a login anywhere on the platform, which is exactly what
 * FORCE_CHANGE_PASSWORD means. Any other state (CONFIRMED, RESET_REQUIRED, or an
 * unlinked federated EXTERNAL_PROVIDER identity) belongs to someone with a real
 * account, and touching it from here would let tenant A invalidate a tenant-B
 * user's password.
 *
 * There is no legitimate case lost by refusing CONFIRMED: `cognito/pre-token.ts`
 * flips PENDING → ACTIVE on any successful login, so a person who already has a
 * password simply signs in and their membership activates itself. There is
 * nothing for an admin to re-send.
 *
 * Non-production short-circuits before any Cognito call (see
 * {@link resendTemporaryPassword} on RESEND vs SUPPRESS). Every deployed
 * environment — QA included — sets NODE_ENV=production
 * (`packages/infra/lib/stacks/api-stack.ts`), so this only affects a developer's
 * machine and vitest, and the real path is still exercised in QA.
 *
 * `tenant` must be forwarded on every branch: without ClientMetadata the
 * CustomMessage trigger (`cognito/custom-message.ts`) passes the event straight
 * through and the invitee receives Cognito's stock template — no tenant name and
 * no login link.
 */
export async function resendCognitoInvite(
  email: string,
  tenant: ProvisionTenantContext,
): Promise<ResendInviteOutcome> {
  if (process.env['NODE_ENV'] !== 'production') return 'skipped'

  const { native, federated } = await findCognitoUsersByEmail(email)

  if (!native) {
    if (federated.length > 0) return 'already_registered'
    await createCognitoUser(email, tenant)
    return 'created'
  }

  if (native.UserStatus !== 'FORCE_CHANGE_PASSWORD') return 'already_registered'

  // Stored case, not the invite's lowercase: see resendTemporaryPassword.
  await resendTemporaryPassword(emailOf(native) ?? email, tenant)
  return 'resent'
}
