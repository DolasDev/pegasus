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
 * Human-readable summary of the Cognito User Pool password policy, shown when a
 * user's new password is rejected for being too short or not complex enough.
 *
 * Source of truth: the `passwordPolicy` block in
 * `packages/infra/lib/stacks/cognito-stack.ts`. Keep this sentence in sync if
 * those rules change (minLength + require{Lowercase,Uppercase,Digits,Symbols}).
 */
export const PASSWORD_POLICY_MESSAGE =
  'Your password must be at least 12 characters and include an uppercase letter, a lowercase letter, a number, and a symbol.'

/**
 * Returns {@link PASSWORD_POLICY_MESSAGE} when `err` is a Cognito rejection of a
 * new password for failing the pool's length/complexity policy; otherwise null.
 *
 * Cognito reports these as `InvalidPasswordException` ("Password did not conform
 * with policy") or, for the hard length floor, `InvalidParameterException` with
 * a validation message naming the `password` field. Callers should prefer this
 * message over the raw Cognito text so the user learns the actual rules:
 *
 *   setError(passwordPolicyMessage(err) ?? fallbackMessage)
 *
 * Only call this where a new password is being set (NEW_PASSWORD_REQUIRED or
 * ConfirmForgotPassword). In the ForgotPassword *request* step an
 * `InvalidParameterException` instead means a federated/SSO-only account, which
 * callers map to a different message.
 */
export function passwordPolicyMessage(err: unknown): string | null {
  if (!(err instanceof CognitoError)) return null
  if (err.code === 'InvalidPasswordException') return PASSWORD_POLICY_MESSAGE
  if (err.code === 'InvalidParameterException' && /password/i.test(err.message)) {
    return PASSWORD_POLICY_MESSAGE
  }
  return null
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
