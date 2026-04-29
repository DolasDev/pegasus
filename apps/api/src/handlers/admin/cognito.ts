// ---------------------------------------------------------------------------
// Shared Cognito helpers for admin handlers
//
// Both the tenant provisioning handler and the tenant-user management handler
// need to call Cognito. This module provides a lazy singleton client and two
// idempotent helpers so the call-site logic stays simple.
// ---------------------------------------------------------------------------

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
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
 * Disables a Cognito user (AdminDisableUser).
 *
 * Fail-open: UserNotFoundException is silently ignored — the user may never
 * have logged in and therefore may not have a Cognito account yet.
 *
 * Throws for all other Cognito errors.
 */
/**
 * Re-enables a previously disabled Cognito user (AdminEnableUser).
 *
 * Fail-open: UserNotFoundException is silently ignored — the user may not
 * have a Cognito account yet (e.g. never completed first login).
 *
 * Throws for all other Cognito errors.
 */
export async function enableCognitoUser(email: string): Promise<void> {
  const userPoolId = process.env['COGNITO_USER_POOL_ID'] ?? ''

  try {
    await getCognito().send(
      new AdminEnableUserCommand({
        UserPoolId: userPoolId,
        Username: email,
      }),
    )
  } catch (err) {
    if ((err as { name?: string }).name === 'UserNotFoundException') return
    throw err
  }
}

export async function disableCognitoUser(email: string): Promise<void> {
  const userPoolId = process.env['COGNITO_USER_POOL_ID'] ?? ''

  try {
    await getCognito().send(
      new AdminDisableUserCommand({
        UserPoolId: userPoolId,
        Username: email,
      }),
    )
  } catch (err) {
    if ((err as { name?: string }).name === 'UserNotFoundException') return
    throw err
  }
}
