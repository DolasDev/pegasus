// ---------------------------------------------------------------------------
// RingCentral MMS attachment lookup.
//
// Pegasus stores only attachment REFERENCES (message id + attachment id); the
// file stays in RingCentral. This fetches it on demand through the tenant's
// RingCentral connection so on-prem clients (which hold no RingCentral
// credentials) can display it. Nothing is written anywhere — the bytes pass
// straight back to the caller.
//
// Looked up by ids rather than through the cloud Message row, which is deleted
// 30 days after forwarding: this keeps working for as long as RingCentral keeps
// the message.
// ---------------------------------------------------------------------------

import { acquireAccessToken, invalidateToken, RateLimitError, type TokenConnection } from './client'

/** A connection's fields needed to address its message store. */
export interface AttachmentConnection extends TokenConnection {
  rcAccountId: string
  rcExtensionId: string
}

export interface AttachmentContent {
  contentType: string
  bytes: Uint8Array
}

const contentPath = (c: AttachmentConnection, messageId: string, attachmentId: string) =>
  `/restapi/v1.0/account/${encodeURIComponent(c.rcAccountId)}` +
  `/extension/${encodeURIComponent(c.rcExtensionId)}` +
  `/message-store/${encodeURIComponent(messageId)}` +
  `/content/${encodeURIComponent(attachmentId)}`

async function getContent(
  connection: AttachmentConnection,
  messageId: string,
  attachmentId: string,
): Promise<Response> {
  const { accessToken, apiBase } = await acquireAccessToken(connection)
  return fetch(new URL(contentPath(connection, messageId, attachmentId), apiBase), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

/**
 * Fetches one MMS attachment's bytes. Tries each of the tenant's connections in
 * order (a tenant normally has one); a connection that doesn't hold the message
 * answers 404 and the next is tried.
 *
 * @returns the content, or `null` when no connection has that message/attachment.
 * @throws {RateLimitError} when RingCentral rate-limits the request.
 * @throws {Error} on any other upstream failure.
 */
export async function fetchAttachmentContent(
  connections: readonly AttachmentConnection[],
  messageId: string,
  attachmentId: string,
): Promise<AttachmentContent | null> {
  for (const connection of connections) {
    let res = await getContent(connection, messageId, attachmentId)
    if (res.status === 401) {
      // RingCentral invalidated the cached token early (e.g. JWT rotation).
      invalidateToken(connection.id)
      res = await getContent(connection, messageId, attachmentId)
    }
    if (res.status === 404) continue
    if (res.status === 429) {
      const seconds = Number(res.headers.get('Retry-After'))
      throw new RateLimitError(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000)
    }
    if (!res.ok) {
      throw new Error(`RingCentral attachment fetch failed: ${res.status}`)
    }
    return {
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      bytes: new Uint8Array(await res.arrayBuffer()),
    }
  }
  return null
}
