// ---------------------------------------------------------------------------
// Scheduled Lambda — push-notification forwarder.
//
// Drains the PushNotificationOutbox (the transactional outbox that handlers and
// domain-event triggers fill) and delivers each notification via the Expo push
// service (lib/push-expo). Cross-tenant: reads the base Prisma client and
// resolves each row's target into that principal's active device tokens.
//
// Runs every minute, and is also kicked asynchronously by callers that just
// enqueued pushes someone is waiting on (move chat, lib/push-forward-invoke).
// The per-row claim + send lives in lib/push-deliver.ts; each row is claimed
// first, so overlapping runs never send a row twice. Delivery model (mirrors
// the RingCentral forwarder):
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
import { deliverPushRows } from './lib/push-deliver'
import { listPendingPush } from './repositories/push-outbox.repository'

const logger = createLogger('pegasus-push-forward')

/** How many outbox rows to drain per run. */
const BATCH_LIMIT = 100

export async function handler(): Promise<void> {
  const pending = await listPendingPush(db, BATCH_LIMIT)
  if (pending.length === 0) {
    logger.info('No pending push notifications')
    return
  }

  const stats = await deliverPushRows(db, pending, logger)
  logger.info('Push forward run complete', { total: pending.length, ...stats })
}
