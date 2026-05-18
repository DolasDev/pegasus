// ---------------------------------------------------------------------------
// Cognito REST client — platform-agnostic wrapper around the Cognito
// Identity Provider Service API.
//
// Uses globalThis.fetch (available in modern browsers, Node 18+, and
// React Native).
// ---------------------------------------------------------------------------

/**
 * Unwraps the Cognito PreTokenGeneration wrapper from a Lambda-thrown message.
 *
 * When a Pre-Token-Generation Lambda throws, Cognito surfaces it as
 * `UserLambdaValidationException` with a message of the form:
 *   "PreTokenGeneration failed with error <the Lambda's own message>."
 *
 * The pre-token Lambda already emits user-ready sentences, so we strip the
 * wrapper (and the single trailing period Cognito appends) and surface only
 * the inner sentence. Messages without the wrapper pass through unchanged.
 */
export function unwrapPreTokenMessage(message: string): string {
  const match = /^PreTokenGeneration failed with error (.+?)\.?$/.exec(message)
  return match ? match[1]! : message
}

/** Typed error carrying the Cognito error code (e.g. NotAuthorizedException). */
export class CognitoError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(unwrapPreTokenMessage(message))
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
