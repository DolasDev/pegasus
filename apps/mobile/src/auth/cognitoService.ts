import { cognitoApiRequest, CognitoError } from '@pegasus/auth'
import { AuthError } from './types'

/**
 * Authenticates a driver via the Cognito USER_PASSWORD_AUTH flow.
 *
 * Uses the shared Cognito REST client from @pegasus/auth. Returns { idToken }
 * on success.
 *
 * Rejects with AuthError on any failure:
 *   - NotAuthorizedException: wrong credentials
 *   - UserNotFoundException: email not registered in the pool
 *   - NewPasswordRequired: Cognito challenge
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

  let json: Record<string, unknown>
  try {
    json = await cognitoApiRequest(region, 'InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: email, PASSWORD: password },
      ClientId: clientId,
    })
  } catch (err) {
    if (err instanceof CognitoError) {
      throw new AuthError(err.code, err.message)
    }
    throw err
  }

  if (json['ChallengeName'] === 'NEW_PASSWORD_REQUIRED') {
    throw new AuthError('NewPasswordRequired', 'Password change required before sign-in')
  }

  const result = json['AuthenticationResult'] as { IdToken: string }
  return { idToken: result.IdToken }
}
