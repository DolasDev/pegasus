// ---------------------------------------------------------------------------
// Scheduled Lambda — RingCentral buffer purge (PII retention).
//
// Neon holds captured SMS only transiently; the on-prem SQL Server is the
// authoritative store once a message is forwarded (SENT). This cron enforces two
// retention steps across all tenants:
//   1. Body purge — once a forwarded message's 72h window (purgeAfter, stamped by
//      markForwardSent) elapses, the PII body is nulled and bodyPurgedAt stamped.
//   2. Tombstone delete — SENT message rows captured more than RETENTION_DAYS ago
//      are hard-deleted (the FK cascade drops their outbox rows). PENDING/FAILED
//      rows (still being delivered) and DEAD rows (kept for investigation) are
//      left untouched.
//
// Inert by construction: with nothing captured the messages table is empty and
// every run is a no-op. Not gated on RINGCENTRAL_ENABLED — retention must keep
// flushing already-captured PII even if the feature is later turned off.
// Scheduling lives in the CDK ApiStack (EventBridge rule).
// ---------------------------------------------------------------------------

import { db } from './db'
import { createLogger } from './lib/logger'
import { purgeForwardedBodies, hardDeleteForwarded } from './repositories/messaging.repository'

const logger = createLogger('pegasus-ringcentral-buffer-purge')

/** Days a forwarded message tombstone is retained in Neon before hard-deletion. */
const RETENTION_DAYS = 30

export async function handler(): Promise<void> {
  const now = new Date()

  const bodiesPurged = await purgeForwardedBodies(db, now)

  const retentionCutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 3_600_000)
  const hardDeleted = await hardDeleteForwarded(db, retentionCutoff)

  logger.info('Buffer purge complete', { bodiesPurged, hardDeleted, retentionDays: RETENTION_DAYS })
}
