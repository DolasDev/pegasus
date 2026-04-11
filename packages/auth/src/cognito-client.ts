// ---------------------------------------------------------------------------
// Cognito REST client — platform-agnostic wrapper around the Cognito
// Identity Provider Service API.
//
// Uses globalThis.fetch (available in modern browsers, Node 18+, and
// React Native).
// ---------------------------------------------------------------------------

/** Typed error carrying the Cognito error code (e.g. NotAuthorizedException). */
export class CognitoError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = code
  }
}

/**
 * Sends a POST request to the Cognito Identity Provider API.
 *
 * @param region  AWS region (e.g. 'us-east-1')
 * @param target  The API action (e.g. 'InitiateAuth', 'RespondToAuthChallenge')
 * @param body    The JSON request body
 * @returns       The parsed JSON response on success
 * @throws        CognitoError on non-2xx responses
 */
export async function cognitoApiRequest(
  region: string,
  target: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  })

  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    throw new CognitoError(
      (json['__type'] as string | undefined) ?? 'UnknownError',
      (json['message'] as string | undefined) ?? 'Authentication failed',
    )
  }
  return json
}
