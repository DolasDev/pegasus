// ---------------------------------------------------------------------------
// RingCentral sync service.
//
// Pulls SMS from both stores using the RingCentral sync API and the stored
// per-store cursors, normalises them, and idempotently captures them:
//   - v1.0 message-store  → ISync (or FSync on first run / SYNC_TOKEN_INVALID)
//   - Thread Messaging     → ISync entries; entries omit phone numbers, so we
//     resolve the from/to pair via Read Thread (cached per thread per run)
//
// Same idempotent capture path as the webhook (Unit 11), so the safety-net sync
// and the near-real-time webhook converge without duplicates. Endpoint paths
// are isolated here (RC API is the documented contract; v1.0 is deprecating).
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import type { ThreadPhonePair } from '@pegasus/domain'
import { DomainError } from '@pegasus/domain'
import { createLogger } from '../../lib/logger'
import type { RingCentralOAuthConfig } from './oauth'
import { RingCentralOAuthError } from './oauth'
import { acquireAccessToken, makeClient, type RingCentralClient } from './client'
import {
  normalizeV1Json,
  normalizeThreadJson,
  type RawV1Message,
  type RawThreadEntry,
} from './normalize'
import {
  getSyncCursor,
  saveSyncCursor,
  captureMessage,
} from '../../repositories/messaging.repository'

const logger = createLogger('pegasus-ringcentral-sync')

const V1_MESSAGE_SYNC = '/restapi/v1.0/account/~/extension/~/message-sync'
const THREAD_ENTRIES_SYNC = '/restapi/v1.0/account/~/message-threads/entries/sync'
const READ_THREAD = (threadId: string) => `/restapi/v1.0/account/~/message-threads/${threadId}`

const DEFAULT_BACKFILL_DAYS = 90

/** A connection's fields the sync needs. */
export interface SyncConnection {
  id: string
  tenantId: string
  ownerNumber: string
  tokenSecretArn: string | null
}

interface SyncInfo {
  syncToken?: string
}
interface MessageSyncResponse {
  records?: RawV1Message[]
  syncInfo?: SyncInfo
}
interface ThreadEntriesSyncResponse {
  records?: Array<RawThreadEntry & { threadId?: string; conversationId?: string }>
  syncInfo?: SyncInfo
}
interface ThreadReadResponse {
  id?: string | number
  recipients?: Array<{ phoneNumber?: string }>
  to?: Array<{ phoneNumber?: string }>
  from?: { phoneNumber?: string }
}

/**
 * True when an RC error indicates the sync token is no longer valid. RC returns
 * CMN-101 / SYNC_TOKEN_INVALID with a 400. Our sync params are controlled (so a
 * 400 isn't a bad-parameter case we'd cause), so any 400 from the sync endpoint
 * is treated as a stale token → fall back to FSync. The fallback runs once and
 * is not recursive, so a genuine persistent 400 still surfaces.
 */
function isSyncTokenInvalid(err: unknown): boolean {
  return err instanceof RingCentralOAuthError && err.status === 400
}

function isoDaysAgo(days: number, now: number): string {
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString()
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface SyncOptions {
  /** Days to backfill on a full sync (first run / invalid token). */
  backfillDays?: number
  now?: number
}

/**
 * Syncs both stores for a connection. Returns the number of messages captured.
 * Throws RateLimitError up to the caller (the cron decides whether to back off).
 */
export async function syncConnection(
  db: PrismaClient,
  config: RingCentralOAuthConfig,
  connection: SyncConnection,
  opts: SyncOptions = {},
): Promise<{ captured: number }> {
  const accessToken = await acquireAccessToken(config, db, connection)
  const client = makeClient(config.apiBase, accessToken)
  const backfillDays = opts.backfillDays ?? DEFAULT_BACKFILL_DAYS
  const now = opts.now ?? Date.now()

  const v1 = await syncV1Store(db, client, connection, backfillDays, now)
  const thread = await syncThreadStore(db, client, connection)
  return { captured: v1 + thread }
}

// ---------------------------------------------------------------------------
// v1.0 message-store
// ---------------------------------------------------------------------------

async function syncV1Store(
  db: PrismaClient,
  client: RingCentralClient,
  connection: SyncConnection,
  backfillDays: number,
  now: number,
): Promise<number> {
  const cursor = await getSyncCursor(db, connection.tenantId, connection.id, 'V1')

  const isyncParams = (token: string): Record<string, string> => ({
    syncType: 'ISync',
    syncToken: token,
    messageType: 'SMS',
  })
  const fsyncParams = (): Record<string, string> => ({
    syncType: 'FSync',
    dateFrom: isoDaysAgo(backfillDays, now),
    messageType: 'SMS',
  })

  let res: MessageSyncResponse
  try {
    res = await client.get<MessageSyncResponse>(
      V1_MESSAGE_SYNC,
      cursor?.syncToken ? isyncParams(cursor.syncToken) : fsyncParams(),
    )
  } catch (err) {
    if (!isSyncTokenInvalid(err)) throw err
    logger.warn('v1 sync token invalid — falling back to FSync', { connectionId: connection.id })
    res = await client.get<MessageSyncResponse>(V1_MESSAGE_SYNC, fsyncParams())
  }

  let captured = 0
  for (const record of res.records ?? []) {
    if (await captureOne(db, connection, () => normalizeV1Json(record), record.id)) captured++
  }
  if (res.syncInfo?.syncToken) {
    await saveSyncCursor(db, connection.tenantId, connection.id, 'V1', res.syncInfo.syncToken)
  }
  return captured
}

// ---------------------------------------------------------------------------
// Thread Messaging store
// ---------------------------------------------------------------------------

async function syncThreadStore(
  db: PrismaClient,
  client: RingCentralClient,
  connection: SyncConnection,
): Promise<number> {
  const cursor = await getSyncCursor(db, connection.tenantId, connection.id, 'THREAD')

  const params: Record<string, string> = cursor?.syncToken
    ? { syncType: 'ISync', syncToken: cursor.syncToken }
    : { syncType: 'FSync' }

  let res: ThreadEntriesSyncResponse
  try {
    res = await client.get<ThreadEntriesSyncResponse>(THREAD_ENTRIES_SYNC, params)
  } catch (err) {
    if (!isSyncTokenInvalid(err)) throw err
    logger.warn('thread sync token invalid — falling back to FSync', {
      connectionId: connection.id,
    })
    res = await client.get<ThreadEntriesSyncResponse>(THREAD_ENTRIES_SYNC, { syncType: 'FSync' })
  }

  // Cache Read-Thread lookups for the run — many entries share a thread.
  const externalByThread = new Map<string, string>()
  let captured = 0

  for (const entry of res.records ?? []) {
    const threadId = entry.threadId ?? entry.conversationId
    if (!threadId) {
      logger.warn('thread entry without a threadId — skipping', { id: entry.id })
      continue
    }
    let external = externalByThread.get(threadId)
    if (external === undefined) {
      external = await resolveThreadExternalNumber(client, threadId, connection.ownerNumber)
      externalByThread.set(threadId, external)
    }
    const direction = entry.direction ?? 'Inbound'
    const phones: ThreadPhonePair =
      direction === 'Inbound'
        ? { from: external, to: connection.ownerNumber }
        : { from: connection.ownerNumber, to: external }

    if (
      await captureOne(db, connection, () => normalizeThreadJson(entry, threadId, phones), entry.id)
    ) {
      captured++
    }
  }

  if (res.syncInfo?.syncToken) {
    await saveSyncCursor(db, connection.tenantId, connection.id, 'THREAD', res.syncInfo.syncToken)
  }
  return captured
}

/**
 * Reads a thread and returns the external party's number — the first recipient
 * phone that isn't the connection's own (company) number. Falls back to the
 * first recipient if none differ.
 */
async function resolveThreadExternalNumber(
  client: RingCentralClient,
  threadId: string,
  ownerNumber: string,
): Promise<string> {
  const thread = await client.get<ThreadReadResponse>(READ_THREAD(threadId))
  const candidates = [
    ...(thread.recipients ?? []),
    ...(thread.to ?? []),
    ...(thread.from ? [thread.from] : []),
  ]
    .map((r) => r.phoneNumber)
    .filter((n): n is string => typeof n === 'string')
  return candidates.find((n) => n !== ownerNumber) ?? candidates[0] ?? ''
}

// ---------------------------------------------------------------------------
// Capture one record, tolerating per-record normalization errors.
// ---------------------------------------------------------------------------

async function captureOne(
  db: PrismaClient,
  connection: SyncConnection,
  normalize: () => ReturnType<typeof normalizeV1Json>,
  rawId: string | number,
): Promise<boolean> {
  try {
    const normalized = normalize()
    await captureMessage(db, connection.tenantId, normalized, connection.id)
    return true
  } catch (err) {
    if (err instanceof DomainError) {
      // Expected: non-SMS, missing/invalid numbers, bad timestamp — skip the
      // record (a malformed one must not abort the whole sync) at WARN.
      logger.warn('skipping un-normalizable RingCentral record', {
        connectionId: connection.id,
        rawId: String(rawId),
        code: err.code,
      })
      return false
    }
    throw err
  }
}
