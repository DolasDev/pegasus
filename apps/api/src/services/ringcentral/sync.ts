// ---------------------------------------------------------------------------
// RingCentral sync service.
//
// Pulls SMS from both stores using the RingCentral sync API and the stored
// per-store cursors, normalizes them, and idempotently captures them:
//   - v1.0 message-store  → ISync (or FSync on first run / SYNC_TOKEN_INVALID).
//     FSync returns at most 250 records; when RC reports `olderRecordsExist`, the
//     rest of the backfill window is paged from the message list, a few pages
//     per run, resuming from the cursor's saved progress.
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
  saveBackfillProgress,
  captureMessage,
} from '../../repositories/messaging.repository'
import { applyInboundKeyword } from '../sms/opt-out-keywords'

const logger = createLogger('pegasus-ringcentral-sync')

const V1_MESSAGE_SYNC = '/restapi/v1.0/account/~/extension/~/message-sync'
const V1_MESSAGE_LIST = '/restapi/v1.0/account/~/extension/~/message-store'
const THREAD_ENTRIES_SYNC = '/restapi/v1.0/account/~/message-threads/entries/sync'
const READ_THREAD = (threadId: string) => `/restapi/v1.0/account/~/message-threads/${threadId}`

const DEFAULT_BACKFILL_DAYS = 90
/** Message-list page size (RC maximum) and pages paged per sync run. */
const BACKFILL_PAGE_SIZE = 1000
const MAX_BACKFILL_PAGES_PER_RUN = 3

/** A connection's fields the sync needs. */
export interface SyncConnection {
  id: string
  tenantId: string
  ownerNumber: string
  tokenSecretArn: string | null
}

interface SyncInfo {
  syncToken?: string
  /** FSync only: true when the 250-record cap left older records unreturned. */
  olderRecordsExist?: boolean
}
interface MessageSyncResponse {
  records?: RawV1Message[]
  syncInfo?: SyncInfo
}
interface MessageListResponse {
  records?: RawV1Message[]
  navigation?: { nextPage?: unknown }
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
  connection: SyncConnection,
  opts: SyncOptions = {},
): Promise<{ captured: number }> {
  const { accessToken, apiBase } = await acquireAccessToken(connection)
  const client = makeClient(apiBase, accessToken)
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

  // Only an incremental pull announces messages as newly received; a full sync
  // re-reads up to `backfillDays` of history (see CaptureOptions).
  let incremental = !!cursor?.syncToken
  let res: MessageSyncResponse
  try {
    res = await client.get<MessageSyncResponse>(
      V1_MESSAGE_SYNC,
      cursor?.syncToken ? isyncParams(cursor.syncToken) : fsyncParams(),
    )
  } catch (err) {
    if (!isSyncTokenInvalid(err)) throw err
    logger.warn('v1 sync token invalid — falling back to FSync', { connectionId: connection.id })
    incremental = false
    res = await client.get<MessageSyncResponse>(V1_MESSAGE_SYNC, fsyncParams())
  }

  let captured = 0
  for (const record of res.records ?? []) {
    if (await captureOne(db, connection, () => normalizeV1Json(record), record.id, incremental)) {
      captured++
    }
  }
  if (res.syncInfo?.syncToken) {
    await saveSyncCursor(db, connection.tenantId, connection.id, 'V1', res.syncInfo.syncToken)
  }

  // Backfill owed beyond the FSync cap: freshly reported by this FSync, or saved
  // by an earlier run that hit the per-run page limit.
  let owed: BackfillWindow | null = null
  if (!incremental && res.syncInfo?.olderRecordsExist) {
    owed = {
      from: new Date(isoDaysAgo(backfillDays, now)),
      before: oldestCreationTime(res.records ?? []) ?? new Date(now),
    }
  } else if (cursor?.backfillFrom && cursor.backfillBefore) {
    owed = { from: cursor.backfillFrom, before: cursor.backfillBefore }
  }
  if (owed) captured += await backfillV1(db, client, connection, owed)
  return captured
}

interface BackfillWindow {
  from: Date
  before: Date
}

function oldestCreationTime(records: RawV1Message[]): Date | null {
  const times = records
    .map((r) => (r.creationTime ? Date.parse(r.creationTime) : NaN))
    .filter((t) => !Number.isNaN(t))
  return times.length ? new Date(Math.min(...times)) : null
}

/**
 * Pages the v1 message list (newest first) over `[from, before)` and captures
 * every record as history (no `sms.received`). Stops after
 * MAX_BACKFILL_PAGES_PER_RUN pages and saves the oldest time seen so the next
 * run resumes below it; clears the saved progress once the list is exhausted.
 * Overlap at the resume boundary is harmless — capture is idempotent.
 */
async function backfillV1(
  db: PrismaClient,
  client: RingCentralClient,
  connection: SyncConnection,
  window: BackfillWindow,
): Promise<number> {
  let captured = 0
  let oldest = window.before
  for (let page = 1; page <= MAX_BACKFILL_PAGES_PER_RUN; page++) {
    const res = await client.get<MessageListResponse>(V1_MESSAGE_LIST, {
      messageType: 'SMS',
      dateFrom: window.from.toISOString(),
      dateTo: window.before.toISOString(),
      perPage: String(BACKFILL_PAGE_SIZE),
      page: String(page),
    })
    const records = res.records ?? []
    for (const record of records) {
      if (await captureOne(db, connection, () => normalizeV1Json(record), record.id, false)) {
        captured++
      }
    }
    const pageOldest = oldestCreationTime(records)
    if (pageOldest && pageOldest < oldest) oldest = pageOldest

    if (!res.navigation?.nextPage || records.length === 0) {
      await saveBackfillProgress(db, connection.tenantId, connection.id, 'V1', null)
      logger.info('v1 backfill complete', { connectionId: connection.id, captured })
      return captured
    }
  }
  await saveBackfillProgress(db, connection.tenantId, connection.id, 'V1', {
    from: window.from,
    before: oldest,
  })
  logger.info('v1 backfill paused at page cap — resumes next run', {
    connectionId: connection.id,
    captured,
    resumeBefore: oldest.toISOString(),
  })
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

  let incremental = !!cursor?.syncToken
  let res: ThreadEntriesSyncResponse
  try {
    res = await client.get<ThreadEntriesSyncResponse>(THREAD_ENTRIES_SYNC, params)
  } catch (err) {
    if (!isSyncTokenInvalid(err)) throw err
    logger.warn('thread sync token invalid — falling back to FSync', {
      connectionId: connection.id,
    })
    incremental = false
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
    // A missing direction is captured as Inbound (forwarding unchanged) but never
    // announced: if a workflow's own reply came back direction-less, emitting it
    // would re-trigger that workflow in a loop.
    const direction = entry.direction ?? 'Inbound'
    const phones: ThreadPhonePair =
      direction === 'Inbound'
        ? { from: external, to: connection.ownerNumber }
        : { from: connection.ownerNumber, to: external }

    if (
      await captureOne(
        db,
        connection,
        () => normalizeThreadJson(entry, threadId, phones),
        entry.id,
        incremental && entry.direction != null,
      )
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
  emitReceivedEvent: boolean,
): Promise<boolean> {
  try {
    const normalized = normalize()
    const message = await captureMessage(db, connection.tenantId, normalized, connection.id, {
      emitReceivedEvent,
    })
    // Opt-out keywords apply in EVERY sync mode (not only when sms.received
    // fires). Non-fatal: a failure here must never abort capture.
    try {
      await applyInboundKeyword(db, connection.tenantId, message)
    } catch (keywordErr) {
      logger.error('failed to apply inbound SMS keyword', {
        connectionId: connection.id,
        rawId: String(rawId),
        error: keywordErr instanceof Error ? keywordErr.message : String(keywordErr),
      })
    }
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
