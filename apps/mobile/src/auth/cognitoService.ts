import { cognitoApiRequest, CognitoError } from '@pegasus/auth'
import { AuthError, type CognitoTokens } from './types'

/** Region from a pool ID (format: "us-east-1_AbCdEfG"). */
function regionOf(poolId: string): string {
  return poolId.split('_')[0]!
}

async function request(
  poolId: string,
  target: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    return await cognitoApiRequest(regionOf(poolId), target, body)
  } catch (err) {
    if (err instanceof CognitoError) {
      throw new AuthError(err.code, err.message)
    }
    throw err
  }
}

type AuthenticationResult = { IdToken: string; RefreshToken?: string }

function tokensOf(json: Record<string, unknown>): CognitoTokens {
  const result = json['AuthenticationResult'] as AuthenticationResult
  return {
    idToken: result.IdToken,
    ...(result.RefreshToken ? { refreshToken: result.RefreshToken } : {}),
  }
}

/**
 * Authenticates a driver via the Cognito USER_PASSWORD_AUTH flow.
 *
 * Uses the shared Cognito REST client from @pegasus/auth. Returns the ID token
 * and the refresh token (kept so the session can be renewed without a fresh
 * sign-in — see AuthContext).
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
): Promise<CognitoTokens> {
  const json = await request(poolId, 'InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: email, PASSWORD: password },
    ClientId: clientId,
  })

  if (json['ChallengeName'] === 'NEW_PASSWORD_REQUIRED') {
    throw new AuthError('NewPasswordRequired', 'Password change required before sign-in')
  }

  return tokensOf(json)
}

/**
 * Exchanges a refresh token from a password sign-in for a fresh ID token
 * (InitiateAuth REFRESH_TOKEN_AUTH). The caller must POST /api/auth/select-tenant
 * first: the Pre-Token trigger resolves a refresh's tenant from that AuthSession.
 *
 * Cognito returns a new refresh token only if the client rotates them (the
 * mobile client doesn't — rotation would also reject this flow); when it does,
 * the caller must store it.
 *
 * Rejects with AuthError — NotAuthorizedException when the token is expired or revoked.
 */
export async function refresh(
  refreshToken: string,
  poolId: string,
  clientId: string,
): Promise<CognitoTokens> {
  const json = await request(poolId, 'InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    AuthParameters: { REFRESH_TOKEN: refreshToken },
    ClientId: clientId,
  })
  return tokensOf(json)
}

/**
 * Revokes a refresh token (and every ID/access token issued from it). Works for
 * a refresh token from either sign-in channel; the client has token revocation
 * enabled. Rejects with AuthError — callers treat it as best-effort.
 */
export async function revoke(
  refreshToken: string,
  poolId: string,
  clientId: string,
): Promise<void> {
  await request(poolId, 'RevokeToken', { Token: refreshToken, ClientId: clientId })
}
