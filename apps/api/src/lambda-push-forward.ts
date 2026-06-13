// ---------------------------------------------------------------------------
// Scheduled Lambda — push-notification forwarder.
//
// Drains the PushNotificationOutbox (the transactional outbox that handlers and
// domain-event triggers fill) and delivers each notification via the Expo push
// service (lib/push-expo). Cross-tenant: reads the base Prisma client and
// resolves each row's target into that principal's active device tokens.
//
// Delivery model (mirrors the RingCentral forwarder):
//   • Resolve target → active Expo tokens. A row whose target has NO active
//     device (driver hasn't registered yet, or just logged out) is treated as a
//     retryable failure with backoff: the driver may register shortly, and the
//     row dead-letters after MAX_ATTEMPTS rather than parking forever.
//   • Send accepted by Expo (≥1 ticket) → mark SENT, record the ticket id.
//   • Tokens Expo flags DeviceNotRegistered → deactivate those DeviceToken rows
//     so we stop targeting dead devices.
//   • Total send failure (network to Expo, or all messages rejected) → record a
//     failed attempt with exponential backoff + jitter, dead-lettering after
//     MAX_ATTEMPTS so a poison row can't retry forever.
//
// Inert by construction: with no notifications enqueued the outbox is empty and
// every run is a no-op. Scheduling lives in the CDK ApiStack (EventBridge rule).
//
// Receipts: Expo confirms final delivery asynchronously via receipts. This v1
// records the ticket id on send; a follow-up receipt-poll pass (using
// getReceipts) can be added to catch async DeviceNotRegistered — see the plan's
// optional receipt Lambda.
// ---------------------------------------------------------------------------

import { db } from './db'
import { createLogger } from './lib/logger'
import { sendToTokens } from './lib/push-expo'
import {
  listPendingPush,
  markPushSent,
  markPushFailed,
  type PushPayloadJson,
} from './repositories/push-outbox.repository'
import {
  listActiveTokensForUser,
  deactivateTokensByValue,
} from './repositories/device-tokens.repository'

const logger = createLogger('pegasus-push-forward')

/** How many outbox rows to drain per run. */
const BATCH_LIMIT = 100
/** Delivery attempts before a row is dead-lettered (DEAD). */
const MAX_ATTEMPTS = 8
/** Base backoff for a failed attempt; doubles per attempt up to the cap. */
const BASE_BACKOFF_MS = 60_000
const MAX_BACKOFF_MS = 60 * 60_000

/** Exponential backoff with up to +20% additive jitter for a failed attempt. */
function backoffFor(attempts: number): Date {
  const base = Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS)
  const jitter = Math.random() * base * 0.2
  return new Date(Date.now() + base + jitter)
}

export async function handler(): Promise<void> {
  const pending = await listPendingPush(db, BATCH_LIMIT)
  if (pending.length === 0) {
    logger.info('No pending push notifications')
    return
  }

  const stats = { sent: 0, failed: 0, dead: 0, tokensDeactivated: 0 }
  for (const row of pending) {
    // Resolve target → effective TenantUser id. A crew target resolves through
    // its linked login (CrewMember.tenantUserId); the link is included by
    // listPendingPush so no second query is needed.
    const effectiveUserId = row.userId ?? row.crewMember?.tenantUserId ?? null

    const recordFailure = async (error: string): Promise<void> => {
      const willExhaust = row.attempts + 1 >= MAX_ATTEMPTS
      await markPushFailed(db, row.id, {
        nextStatus: willExhaust ? 'DEAD' : 'FAILED',
        error,
        // A DEAD row is terminal; keep nextAttemptAt at now so a manual redrive
        // to PENDING is immediately due rather than parked behind a backoff.
        nextAttemptAt: willExhaust ? new Date() : backoffFor(row.attempts + 1),
      })
      if (willExhaust) {
        stats.dead++
        logger.error('Push dead-lettered after exhausting retries', {
          outboxId: row.id,
          attempts: row.attempts + 1,
          error,
        })
      } else {
        stats.failed++
        logger.warn('Push failed — will retry with backoff', {
          outboxId: row.id,
          attempts: row.attempts + 1,
          error,
        })
      }
    }

    if (!effectiveUserId) {
      await recordFailure('target has no linked tenant user')
      continue
    }

    const tokens = await listActiveTokensForUser(db, row.tenantId, effectiveUserId)
    if (tokens.length === 0) {
      await recordFailure('target has no active device tokens')
      continue
    }

    try {
      const payload = row.payload as PushPayloadJson
      const result = await sendToTokens(tokens, {
        title: payload.title,
        body: payload.body,
        ...(payload.data ? { data: payload.data } : {}),
      })

      // Retire any tokens Expo flagged as permanently dead, regardless of
      // whether the overall send succeeded.
      if (result.invalidTokens.length > 0) {
        const n = await deactivateTokensByValue(db, result.invalidTokens)
        stats.tokensDeactivated += n
      }

      if (result.anyAccepted) {
        await markPushSent(db, row.id, result.ticketIds[0] ?? null)
        stats.sent++
      } else {
        await recordFailure(result.error ?? 'Expo accepted no messages')
      }
    } catch (err) {
      await recordFailure(err instanceof Error ? err.message : String(err))
    }
  }

  logger.info('Push forward run complete', { total: pending.length, ...stats })
}
