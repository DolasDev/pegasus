// ---------------------------------------------------------------------------
// RingCentral message-store read status.
//
// RingCentral is the source of truth for a text's read/unread state: the
// legacy desktop's reconciliation copies `readStatus` from RingCentral into its
// TextMessageStore on every pass (movemanager IO_TextMessageStore.Upsert), and
// the desktop itself marks read by PUTting here first. So marking read from
// the cloud means this PUT — a write only to the desktop's mirror would be
// reverted by the next reconciliation.
//
// Only V1 message-store ids are addressable here; thread-store entries are not.
// Same stale-token retry as sendSms: a 401 drops the cached token and retries once.
// ---------------------------------------------------------------------------

import { acquireAccessToken, invalidateToken, makeClient, type TokenConnection } from './client'
import { RingCentralOAuthError } from './oauth'

export type RcReadStatus = 'Read' | 'Unread'

interface RcMessageResource {
  id?: number | string
  readStatus?: string
  [key: string]: unknown
}

const messagePath = (externalId: string) =>
  `/restapi/v1.0/account/~/extension/~/message-store/${encodeURIComponent(externalId)}`

async function withTokenRetry<T>(
  connection: TokenConnection,
  call: (client: ReturnType<typeof makeClient>) => Promise<T>,
): Promise<T> {
  const attempt = async () => {
    const { accessToken, apiBase } = await acquireAccessToken(connection)
    return call(makeClient(apiBase, accessToken))
  }
  try {
    return await attempt()
  } catch (err) {
    if (err instanceof RingCentralOAuthError && err.status === 401) {
      invalidateToken(connection.id)
      return await attempt()
    }
    throw err
  }
}

/**
 * Marks one V1 message-store message read (or unread). Reads the current state
 * first so the caller can report `alreadyRead` and so an already-read message
 * costs no write.
 *
 * @throws {RateLimitError}        on 429.
 * @throws {RingCentralOAuthError} on other RingCentral errors (404 = unknown id).
 */
export async function setMessageReadStatus(
  connection: TokenConnection,
  externalId: string,
  readStatus: RcReadStatus,
): Promise<{ readStatus: RcReadStatus; changed: boolean }> {
  return withTokenRetry(connection, async (client) => {
    const current = await client.get<RcMessageResource>(messagePath(externalId))
    if (current.readStatus === readStatus) return { readStatus, changed: false }
    const updated = await client.put<RcMessageResource>(messagePath(externalId), { readStatus })
    return {
      readStatus: updated.readStatus === 'Unread' ? 'Unread' : 'Read',
      changed: true,
    }
  })
}
