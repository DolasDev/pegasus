// ---------------------------------------------------------------------------
// Push delivery — the per-row claim + send run by the push forwarder
// (lambda-push-forward), whether it fires on its one-minute schedule or is
// kicked by a caller that just enqueued pushes someone is waiting on (move
// chat, lib/push-forward-invoke).
//
// Every row is CLAIMED before it is sent (repositories/push-outbox.claimPush), so
// a kicked run and the scheduled run — or any two overlapping runs — never
// deliver the same row twice. A row another run already claimed is skipped,
// not failed.
//
// Delivery model:
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
// Imports `expo-server-sdk` (ESM-only) through ./push-expo, so only the
// forwarder's ESM bundle may import this file — never the API Lambda's.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import type { Logger } from '@aws-lambda-powertools/logger'
import { sendToTokens } from './push-expo'
import {
  claimPush,
  markPushSent,
  markPushFailed,
  type PushPayloadJson,
} from '../repositories/push-outbox.repository'
import {
  listActiveTokensForUser,
  deactivateTokensByValue,
} from '../repositories/device-tokens.repository'

/** Delivery attempts before a row is dead-lettered (DEAD). */
export const MAX_ATTEMPTS = 8
/** Base backoff for a failed attempt; doubles per attempt up to the cap. */
const BASE_BACKOFF_MS = 60_000
const MAX_BACKOFF_MS = 60 * 60_000

/** Exponential backoff with up to +20% additive jitter for a failed attempt. */
function backoffFor(attempts: number): Date {
  const base = Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS)
  const jitter = Math.random() * base * 0.2
  return new Date(Date.now() + base + jitter)
}

/** An outbox row as `listPendingPush` returns it. */
export interface DeliverablePushRow {
  id: string
  tenantId: string
  userId: string | null
  crewMember: { tenantUserId: string | null } | null
  attempts: number
  nextAttemptAt: Date
  payload: unknown
}

export interface PushDeliveryStats {
  sent: number
  failed: number
  dead: number
  /** Rows another drainer claimed first — not attempted by this caller. */
  skipped: number
  tokensDeactivated: number
}

/** Claims and delivers each row in turn. Never throws for a single row's failure. */
export async function deliverPushRows(
  db: PrismaClient,
  rows: readonly DeliverablePushRow[],
  logger: Logger,
): Promise<PushDeliveryStats> {
  const stats: PushDeliveryStats = { sent: 0, failed: 0, dead: 0, skipped: 0, tokensDeactivated: 0 }

  for (const row of rows) {
    if (!(await claimPush(db, row))) {
      stats.skipped++
      continue
    }

    // Resolve target → effective TenantUser id. A crew target resolves through
    // its linked login (CrewMember.tenantUserId), included by the list query.
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
        stats.tokensDeactivated += await deactivateTokensByValue(db, result.invalidTokens)
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

  return stats
}
