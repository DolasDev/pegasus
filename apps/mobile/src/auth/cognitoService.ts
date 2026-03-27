import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
} from 'amazon-cognito-identity-js'
import { AuthError } from './types'
import { logger } from '../utils/logger'

/**
 * Authenticates a driver via the Cognito SRP (ALLOW_USER_SRP_AUTH) flow.
 *
 * Returns { idToken } on success — the raw ID token string from the Cognito
 * session. Access and refresh tokens are intentionally discarded; only the ID
 * token is passed to POST /api/auth/validate-token.
 *
 * Rejects with AuthError on any failure:
 *   - NotAuthorizedException: wrong credentials
 *   - UserNotFoundException: email not registered in the pool
 *   - NewPasswordRequired: Cognito challenge (account provisioned, password reset needed)
 *   - NetworkError: no connectivity
 *   - UnknownError: fallback for any other condition
 */
export async function signIn(
  email: string,
  password: string,
  poolId: string,
  clientId: string,
): Promise<{ idToken: string }> {
  return new Promise((resolve, reject) => {
    const pool = new CognitoUserPool({ UserPoolId: poolId, ClientId: clientId })
    const user = new CognitoUser({ Username: email, Pool: pool })
    const authDetails = new AuthenticationDetails({ Username: email, Password: password })

    user.authenticateUser(authDetails, {
      onSuccess(session) {
        logger.logAuth('login', email)
        resolve({ idToken: session.getIdToken().getJwtToken() })
      },
      onFailure(err: { code?: string; message?: string }) {
        reject(new AuthError(err.code ?? 'UnknownError', err.message ?? 'Authentication failed'))
      },
      newPasswordRequired() {
        reject(new AuthError('NewPasswordRequired', 'Password change required before sign-in'))
      },
    })
  })
}
