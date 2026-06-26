// ---------------------------------------------------------------------------
// RingCentral outbound SMS helper.
//
// Thin wrapper over the shared client so the HTTP handler stays unit-testable
// (the caller mocks this module). acquireAccessToken handles JWT-bearer +
// in-memory caching; makeClient builds the authenticated REST wrapper.
// ---------------------------------------------------------------------------

import { acquireAccessToken, invalidateToken, makeClient, type TokenConnection } from './client'
import { RingCentralOAuthError } from './oauth'

/** Minimum subset of a RingCentralConnection row needed to send an SMS. */
export interface SmsConnection extends TokenConnection {
  ownerNumber: string
}

/** Sent-message resource returned by the RingCentral SMS endpoint. */
export interface RcSmsResponse {
  id?: number | string
  messageStatus?: string
  [key: string]: unknown
}

/** One SMS POST using whatever token {@link acquireAccessToken} returns. */
async function postSms(
  connection: SmsConnection,
  to: string,
  body: string,
): Promise<RcSmsResponse> {
  const { accessToken, apiBase } = await acquireAccessToken(connection)
  const client = makeClient(apiBase, accessToken)
  return client.post<RcSmsResponse>('/restapi/v1.0/account/~/extension/~/sms', {
    from: { phoneNumber: connection.ownerNumber },
    to: [{ phoneNumber: to }],
    text: body,
  })
}

/**
 * Sends an outbound SMS via RingCentral using the connection's stored
 * JWT credentials. Acquires (or reuses a cached) access token, then POSTs
 * to the SMS endpoint with the connection's phone number as the sender.
 *
 * A cached access token can be invalidated by RingCentral *before* its local
 * `expires_in` (RC's `TokenInvalid` / OAU-213 "Token not found") — e.g. when the
 * SMS, sync, and subscription-manager callers, which share the JWT, mint tokens
 * in separate warm containers and rotate each other out. The TTL-only cache
 * keeps re-presenting the dead token. So on a 401 we drop the cached token,
 * re-mint from the JWT, and retry the send exactly once.
 *
 * @throws {RateLimitError}      on 429 — caller should return 429.
 * @throws {RingCentralOAuthError} on other RC errors — caller maps by isPermanent.
 */
export async function sendSms(
  connection: SmsConnection,
  to: string,
  body: string,
): Promise<RcSmsResponse> {
  try {
    return await postSms(connection, to, body)
  } catch (err) {
    if (err instanceof RingCentralOAuthError && err.status === 401) {
      // Stale cached token — force a fresh mint and try once more.
      invalidateToken(connection.id)
      return await postSms(connection, to, body)
    }
    throw err
  }
}
