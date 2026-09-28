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
//   3. Event-body purge — the SMS text copied into dispatched `sms.received`
//      DomainEvent payloads (the workflow trigger input) is nulled after the
//      same 72h window, measured from the event's occurrence.
//
// Inert by construction: with nothing captured the messages table is empty and
// every run is a no-op. Not gated on RINGCENTRAL_ENABLED — retention must keep
// flushing already-captured PII even if the feature is later turned off.
// Scheduling lives in the CDK ApiStack (EventBridge rule).
// ---------------------------------------------------------------------------

import { db } from './db'
import { createLogger } from './lib/logger'
import {
  purgeForwardedBodies,
  hardDeleteForwarded,
  purgeReceivedEventBodies,
} from './repositories/messaging.repository'

const logger = createLogger('pegasus-ringcentral-buffer-purge')

/** Days a forwarded message tombstone is retained in Neon before hard-deletion. */
const RETENTION_DAYS = 30

/** Hours the SMS text is kept in a dispatched `sms.received` event payload. */
const EVENT_BODY_RETENTION_HOURS = 72

export async function handler(): Promise<void> {
  const now = new Date()

  const bodiesPurged = await purgeForwardedBodies(db, now)

  const retentionCutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 3_600_000)
  const hardDeleted = await hardDeleteForwarded(db, retentionCutoff)

  const eventCutoff = new Date(now.getTime() - EVENT_BODY_RETENTION_HOURS * 3_600_000)
  const eventBodiesPurged = await purgeReceivedEventBodies(db, eventCutoff)

  logger.info('Buffer purge complete', {
    bodiesPurged,
    hardDeleted,
    eventBodiesPurged,
    retentionDays: RETENTION_DAYS,
  })
}
