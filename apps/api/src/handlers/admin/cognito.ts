// ---------------------------------------------------------------------------
// Shared Cognito helpers for admin handlers
//
// Both the tenant provisioning handler and the tenant-user management handler
// need to call Cognito. This module provides a lazy singleton client and a few
// idempotent helpers so the call-site logic stays simple.
// ---------------------------------------------------------------------------

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminResetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider'

// ---------------------------------------------------------------------------
// Cognito client — lazy singleton reused across warm Lambda invocations.
// Region is resolved automatically from the Lambda execution environment.
// ---------------------------------------------------------------------------
let _cognito: CognitoIdentityProviderClient | null = null
export function getCognito(): CognitoIdentityProviderClient {
  return (_cognito ??= new CognitoIdentityProviderClient({}))
}

export interface ProvisionTenantContext {
  tenantId: string
  tenantName: string
  tenantSlug: string
}

/**
 * Provisions a Cognito user (AdminCreateUser).
 *
 * The user is created with FORCE_CHANGE_PASSWORD status. Cognito sends the
 * invite email with a temporary password unless the runtime is non-production,
 * in which case the email is suppressed.
 *
 * `tenant` is forwarded to the CustomMessage Lambda trigger via ClientMetadata
 * so the invite email can name the tenant and link to the right login page.
 *
 * Idempotent: UsernameExistsException is silently ignored so callers can retry
 * without side effects after a previous partial failure.
 */
export async function provisionCognitoUser(
  email: string,
  tenant: ProvisionTenantContext,
): Promise<void> {
  const userPoolId = process.env['COGNITO_USER_POOL_ID'] ?? ''

  try {
    await getCognito().send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
        ClientMetadata: {
          source: 'tenant',
          tenantId: tenant.tenantId,
          tenantName: tenant.tenantName,
          tenantSlug: tenant.tenantSlug,
        },
        ...(process.env['NODE_ENV'] !== 'production' ? { MessageAction: 'SUPPRESS' as const } : {}),
      }),
    )
  } catch (err) {
    if ((err as { name?: string }).name === 'UsernameExistsException') return
    throw err
  }
}

/**
 * Triggers an admin-initiated password reset (AdminResetUserPassword).
 *
 * Sets the user to RESET_REQUIRED and emails them a confirmation code. The user
 * then completes the reset through the same self-service confirm UI
 * (ConfirmForgotPassword) — the admin never handles a temporary secret.
 *
 * Fail-open: UserNotFoundException is silently ignored — the user may never
 * have completed first login and therefore may not have a Cognito account yet.
 *
 * Throws for all other Cognito errors.
 */
export async function resetCognitoUserPassword(email: string): Promise<void> {
  const userPoolId = process.env['COGNITO_USER_POOL_ID'] ?? ''

  try {
    await getCognito().send(
      new AdminResetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: email,
      }),
    )
  } catch (err) {
    if ((err as { name?: string }).name === 'UserNotFoundException') return
    throw err
  }
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
 * FORCE_CHANGE_PASSWORD means. Any other state (CONFIRMED, RESET_REQUIRED,
 * EXTERNAL_PROVIDER) belongs to someone with a real account, and touching it
 * from here would let tenant A invalidate a tenant-B user's password.
 *
 * There is no legitimate case lost by refusing CONFIRMED: `cognito/pre-token.ts`
 * flips PENDING → ACTIVE on any successful login, so a person who already has a
 * password simply signs in and their membership activates itself. There is
 * nothing for an admin to re-send.
 *
 * `MessageAction` is a single enum value, so RESEND cannot be combined with the
 * SUPPRESS that {@link provisionCognitoUser} uses to keep invite email out of
 * local dev. Non-production therefore short-circuits before any Cognito call.
 * Every deployed environment — QA included — sets NODE_ENV=production
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

  const userPoolId = process.env['COGNITO_USER_POOL_ID'] ?? ''

  let userStatus: string | undefined
  try {
    const user = await getCognito().send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }),
    )
    userStatus = user.UserStatus
  } catch (err) {
    if ((err as { name?: string }).name !== 'UserNotFoundException') throw err
    await provisionCognitoUser(email, tenant)
    return 'created'
  }

  if (userStatus !== 'FORCE_CHANGE_PASSWORD') return 'already_registered'

  // No UserAttributes on a RESEND — the account already carries them, and
  // Cognito only wants the identity plus the message action here.
  await getCognito().send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: email,
      MessageAction: 'RESEND',
      ClientMetadata: {
        source: 'tenant',
        tenantId: tenant.tenantId,
        tenantName: tenant.tenantName,
        tenantSlug: tenant.tenantSlug,
      },
    }),
  )
  return 'resent'
}
