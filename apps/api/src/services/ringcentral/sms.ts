// ---------------------------------------------------------------------------
// RingCentral outbound SMS helper.
//
// Thin wrapper over the shared client so the HTTP handler stays unit-testable
// (the caller mocks this module). acquireAccessToken handles JWT-bearer +
// in-memory caching; makeClient builds the authenticated REST wrapper.
// ---------------------------------------------------------------------------

import { withRingCentralToken, type TokenConnection } from './client'

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

/**
 * Sends an outbound SMS via RingCentral from the connection's phone number,
 * using the connection's shared access token.
 *
 * RingCentral can revoke a token before its `expires_in` (401 `TokenInvalid` /
 * OAU-213 "Token not found"), e.g. when its per-user session cap evicts it.
 * withRingCentralToken then discards that token and retries the send once.
 *
 * @throws {RateLimitError}      on 429 — caller should return 429.
 * @throws {RingCentralOAuthError} on other RC errors — caller maps by isPermanent.
 */
export async function sendSms(
  connection: SmsConnection,
  to: string,
  body: string,
): Promise<RcSmsResponse> {
  return withRingCentralToken(connection, (client) =>
    client.post<RcSmsResponse>('/restapi/v1.0/account/~/extension/~/sms', {
      from: { phoneNumber: connection.ownerNumber },
      to: [{ phoneNumber: to }],
      text: body,
    }),
  )
}
