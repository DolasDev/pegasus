import { AuthError } from './types'

/**
 * Authenticates a driver via the Cognito USER_PASSWORD_AUTH flow.
 *
 * Uses the Cognito REST API directly instead of amazon-cognito-identity-js
 * (which uses SRP and performs heavy BigInteger math on the JS thread,
 * causing 30s+ login delays on Hermes).
 *
 * Returns { idToken } on success — the raw ID token string.
 *
 * Rejects with AuthError on any failure:
 *   - NotAuthorizedException: wrong credentials
 *   - UserNotFoundException: email not registered in the pool
 *   - NewPasswordRequired: Cognito challenge
 *   - NetworkError: no connectivity
 *   - UnknownError: fallback
 */
export async function signIn(
  email: string,
  password: string,
  poolId: string,
  clientId: string,
): Promise<{ idToken: string }> {
  // Extract region from pool ID (format: "us-east-1_AbCdEfG")
  const region = poolId.split('_')[0]

  const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: email, PASSWORD: password },
      ClientId: clientId,
    }),
  })

  const json = (await res.json()) as Record<string, unknown>

  if (!res.ok) {
    const code = (json['__type'] as string | undefined) ?? 'UnknownError'
    const message = (json['message'] as string | undefined) ?? 'Authentication failed'
    throw new AuthError(code, message)
  }

  if (json['ChallengeName'] === 'NEW_PASSWORD_REQUIRED') {
    throw new AuthError('NewPasswordRequired', 'Password change required before sign-in')
  }

  const result = json['AuthenticationResult'] as { IdToken: string }
  return { idToken: result.IdToken }
}
