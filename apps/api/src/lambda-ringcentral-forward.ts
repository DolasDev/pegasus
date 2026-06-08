// ---------------------------------------------------------------------------
// Scheduled Lambda — RingCentral on-prem forwarder.
//
// Drains the MessageForwardOutbox (the transactional outbox captureMessage fills)
// and writes each captured SMS to the tenant's on-prem SQL Server via the
// existing in-VPC mssql-executor (executeSql → idempotent MERGE built by Unit 12).
// At-least-once delivery is made effectively-once by the MERGE's
// (tenant_id, source, external_id) key, so a redelivered row is a no-op on-prem.
//
// Failure handling distinguishes two worlds:
//   • On-prem unreachable / not configured (executor invoke failure, or the
//     tenant has no connection string) → PARK the row PENDING with a short
//     backoff and DO NOT consume a delivery attempt. A multi-hour outage must not
//     dead-letter the whole backlog — the messages simply wait.
//   • A genuine query/data error (the MERGE itself failed) → record a failed
//     attempt with exponential backoff + jitter, dead-lettering after
//     MAX_ATTEMPTS so one poison row can't be retried forever.
//
// Inert by construction: with RINGCENTRAL_ENABLED unset nothing captures, so the
// outbox is empty and every run is a no-op. (We deliberately do NOT gate on the
// OAuth config — if the feature is later turned off, already-captured messages
// must still be allowed to flush to on-prem.) Scheduling lives in the CDK
// ApiStack (EventBridge rule).
// ---------------------------------------------------------------------------

import { db } from './db'
import { createLogger } from './lib/logger'
import { executeSql, MssqlExecError } from './lib/mssql-executor-client'
import { buildInboundMessageMerge } from './services/ringcentral/onprem-merge'
import {
  listPendingForwards,
  markForwardSent,
  markForwardFailed,
  parkForward,
} from './repositories/messaging.repository'

const logger = createLogger('pegasus-ringcentral-forward')

/** How many outbox rows to drain per run. */
const BATCH_LIMIT = 100
/** Delivery attempts before a row is dead-lettered (DEAD). */
const MAX_ATTEMPTS = 8
/** Base backoff for a failed attempt; doubles per attempt up to the cap. */
const BASE_BACKOFF_MS = 60_000
const MAX_BACKOFF_MS = 60 * 60_000
/** Fixed backoff while the on-prem side is unreachable (parked, no attempt spent). */
const PARK_BACKOFF_MS = 5 * 60_000
/** Hours a forwarded message's PII body lingers in Neon before buffer-purge nulls it. */
const PURGE_WINDOW_HOURS = 72

/** Exponential backoff with up to +20% additive jitter for a genuine failure. */
function backoffFor(attempts: number): Date {
  const base = Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS)
  const jitter = Math.random() * base * 0.2
  return new Date(Date.now() + base + jitter)
}

/** A transient on-prem/infra failure parks the row; a query error counts an attempt. */
function isOnPremUnreachable(err: unknown): boolean {
  return (
    err instanceof MssqlExecError &&
    (err.code === 'EXECUTOR_INVOKE_FAILED' || err.code === 'EXECUTOR_NOT_CONFIGURED')
  )
}

export async function handler(): Promise<void> {
  const pending = await listPendingForwards(db, BATCH_LIMIT)
  if (pending.length === 0) {
    logger.info('No pending forwards')
    return
  }

  // Resolve each tenant's on-prem connection string once.
  const tenantIds = [...new Set(pending.map((row) => row.tenantId))]
  const tenants = await db.tenant.findMany({
    where: { id: { in: tenantIds } },
    select: { id: true, mssqlConnectionString: true },
  })
  const connByTenant = new Map(tenants.map((t) => [t.id, t.mssqlConnectionString]))

  const stats = { sent: 0, parked: 0, failed: 0, dead: 0 }
  for (const row of pending) {
    const connectionString = connByTenant.get(row.tenantId)
    if (!connectionString) {
      // No on-prem target configured for this tenant — park, don't burn attempts.
      await parkForward(
        db,
        row.id,
        new Date(Date.now() + PARK_BACKOFF_MS),
        'tenant has no mssqlConnectionString',
      )
      stats.parked++
      continue
    }

    const message = row.message
    try {
      const { sql, params } = buildInboundMessageMerge({
        tenantId: row.tenantId,
        source: message.source,
        externalId: message.externalId,
        threadId: message.threadId,
        direction: message.direction,
        fromNumber: message.fromNumber,
        toNumber: message.toNumber,
        body: message.body,
        rcCreationTime: message.rcCreationTime,
        rcLastModifiedTime: message.rcLastModifiedTime,
      })
      await executeSql(connectionString, sql, { params })
      await markForwardSent(
        db,
        row.id,
        message.id,
        new Date(Date.now() + PURGE_WINDOW_HOURS * 3_600_000),
      )
      stats.sent++
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      if (isOnPremUnreachable(err)) {
        await parkForward(db, row.id, new Date(Date.now() + PARK_BACKOFF_MS), errorMessage)
        stats.parked++
        logger.warn('On-prem unreachable — parked forward for retry', {
          outboxId: row.id,
          error: errorMessage,
        })
        continue
      }
      const willExhaust = row.attempts + 1 >= MAX_ATTEMPTS
      await markForwardFailed(db, row.id, message.id, {
        nextStatus: willExhaust ? 'DEAD' : 'FAILED',
        error: errorMessage,
        // A DEAD row is terminal; keep nextAttemptAt sane (now) rather than a
        // pointless future backoff, so a manual redrive to PENDING is due at once.
        nextAttemptAt: willExhaust ? new Date() : backoffFor(row.attempts + 1),
      })
      if (willExhaust) {
        stats.dead++
        logger.error('Forward dead-lettered after exhausting retries', {
          outboxId: row.id,
          messageId: message.id,
          attempts: row.attempts + 1,
          error: errorMessage,
        })
      } else {
        stats.failed++
        logger.warn('Forward failed — will retry with backoff', {
          outboxId: row.id,
          attempts: row.attempts + 1,
          error: errorMessage,
        })
      }
    }
  }

  logger.info('Forward run complete', { total: pending.length, ...stats })
}
