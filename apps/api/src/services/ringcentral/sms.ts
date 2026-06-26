// ---------------------------------------------------------------------------
// RingCentral outbound SMS helper.
//
// Thin wrapper over the shared client so the HTTP handler stays unit-testable
// (the caller mocks this module). acquireAccessToken handles JWT-bearer +
// in-memory caching; makeClient builds the authenticated REST wrapper.
// ---------------------------------------------------------------------------

import { acquireAccessToken, makeClient, type TokenConnection } from './client'

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
 * Sends an outbound SMS via RingCentral using the connection's stored
 * JWT credentials. Acquires (or reuses a cached) access token, then POSTs
 * to the SMS endpoint with the connection's phone number as the sender.
 *
 * @throws {RateLimitError}      on 429 — caller should return 429.
 * @throws {RingCentralOAuthError} on other RC errors — caller maps by isPermanent.
 */
export async function sendSms(
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
