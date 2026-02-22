// ---------------------------------------------------------------------------
// Cognito Pre-Authentication Lambda trigger
//
// Fires at the start of every sign-in attempt, before the authentication
// challenge flow completes. Used to enforce TOTP MFA for any user who is a
// member of the PLATFORM_ADMIN group.
//
// Tenant users (not in the group) pass through without MFA checks so they
// are not affected by the pool-level MFA=OPTIONAL setting.
//
// Fail-closed policy: if the group or MFA status cannot be determined due
// to an unexpected error, sign-in is blocked. This prevents a misconfigured
// IAM policy from silently granting unenrolled access.
//
// Check ordering (group membership FIRST, then status):
//   Non-admin users pass through regardless of their UserStatus so that
//   the normal Cognito challenge flow can handle password resets etc.
//   Platform admins are subject to strict checks: FORCE_CHANGE_PASSWORD is
//   an anomalous state (the create-admin-user script always sets a permanent
//   password before adding the user to the group) and is treated as a
//   configuration error rather than a bypass.
// ---------------------------------------------------------------------------

import type { PreAuthenticationTriggerHandler } from 'aws-lambda'
import {
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'

const cognitoClient = new CognitoIdentityProviderClient({})

const PLATFORM_ADMIN_GROUP = 'PLATFORM_ADMIN'

/**
 * Blocks sign-in for PLATFORM_ADMIN users who have not enrolled TOTP MFA.
 *
 * Invariants guaranteed on successful return:
 *  - The user is NOT in PLATFORM_ADMIN, OR
 *  - The user IS in PLATFORM_ADMIN, has CONFIRMED status, and has at least
 *    one MFA method enrolled.
 */
export const handler: PreAuthenticationTriggerHandler = async (event) => {
  // Cognito passes the pool ID and username on every trigger event — no env
  // var needed (which would create a CloudFormation circular dependency).
  const userPoolId = event.userPoolId
  const userName = event.userName

  if (!userPoolId || !userName) {
    console.error('Pre-auth trigger: missing userPoolId or userName', {
      userPoolId: userPoolId ?? '(unset)',
      userName: userName ?? '(unset)',
    })
    throw new Error('Authentication configuration error. Please contact support.')
  }

  try {
    // -----------------------------------------------------------------------
    // Step 1 — Fetch user record (status + MFA settings in one call) and
    //           group membership in parallel to minimise latency.
    // -----------------------------------------------------------------------
    const [userResponse, groupsResponse] = await Promise.all([
      cognitoClient.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: userName })),
      cognitoClient.send(
        new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: userName }),
      ),
    ])

    // -----------------------------------------------------------------------
    // Step 2 — Group membership check (evaluated before status)
    //
    // Non-admin users are never subject to MFA enforcement here. Their normal
    // Cognito challenge flow handles password resets and other status states.
    // -----------------------------------------------------------------------
    const isPlatformAdmin =
      groupsResponse.Groups?.some((g) => g.GroupName === PLATFORM_ADMIN_GROUP) ?? false

    if (!isPlatformAdmin) {
      return event
    }

    // -----------------------------------------------------------------------
    // Step 3 — PLATFORM_ADMIN: reject anomalous account states
    //
    // FORCE_CHANGE_PASSWORD means the admin was created without the guided
    // script (which always sets a permanent password). Block until the
    // account is properly onboarded.
    // -----------------------------------------------------------------------
    if (userResponse.UserStatus === 'FORCE_CHANGE_PASSWORD') {
      throw new Error(
        'Your administrator account setup is incomplete. ' +
          'Please contact your system administrator to complete onboarding.',
      )
    }

    // -----------------------------------------------------------------------
    // Step 4 — PLATFORM_ADMIN: require at least one enrolled MFA method
    // -----------------------------------------------------------------------
    const hasMfa = (userResponse.UserMFASettingList?.length ?? 0) > 0

    if (!hasMfa) {
      throw new Error(
        'MFA enrollment is required for platform administrator accounts. ' +
          'Run `npm run create-admin-user` to complete setup, or contact your administrator.',
      )
    }

    return event
  } catch (err) {
    // Re-throw intentional security rejections unchanged so Cognito surfaces
    // the correct message to the user.
    if (
      err instanceof Error &&
      (err.message.includes('MFA enrollment is required') ||
        err.message.includes('account setup is incomplete'))
    ) {
      throw err
    }

    // Any unexpected error (IAM, network, Cognito API) — fail closed.
    console.error('Pre-auth trigger: unexpected error during MFA check', err)
    throw new Error('Authentication check failed. Please try again or contact support.')
  }
}
