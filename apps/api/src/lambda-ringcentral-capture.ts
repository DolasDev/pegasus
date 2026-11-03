// ---------------------------------------------------------------------------
// SQS consumer — RingCentral capture worker.
//
// Drains capture jobs enqueued by the webhook (Unit 10). Thread webhook events
// are thin (lastModifiedTime only), so the actual records are pulled via the
// sync API: the worker runs the same idempotent dual-store sync (Unit 7) for
// the job's connection, then marks the raw webhook event processed.
//
// Idempotent with the reconciliation-sync safety net — both converge on the
// (tenantId, source, externalId) upsert, so a webhook + a sync seeing the same
// message produce one row. Uses partial-batch-response so only failed records
// are retried (and eventually dead-lettered) by SQS.
//
// When the batch emitted any `sms.received`, the worker kicks the trigger
// dispatcher once (lib/trigger-dispatch-kick.ts) so reply workflows start in
// seconds instead of at the next minute tick.
// ---------------------------------------------------------------------------

import type { SQSEvent, SQSBatchResponse, SQSRecord } from 'aws-lambda'
import { db } from './db'
import { createLogger } from './lib/logger'
import { kickTriggerDispatcher } from './lib/trigger-dispatch-kick'
import { readOAuthConfig } from './services/ringcentral/oauth'
import { syncConnection } from './services/ringcentral/sync'
import {
  findConnectionById,
  markWebhookEventProcessed,
  markWebhookEventFailed,
} from './repositories/messaging.repository'
import type { CaptureJob } from './lib/ringcentral-queue'

const logger = createLogger('pegasus-ringcentral-capture')

/** Returns how many `sms.received` events the record's sync emitted. */
async function processRecord(record: SQSRecord): Promise<number> {
  const config = readOAuthConfig()
  if (!config) {
    // Flag off — drop the job (don't fail the record into the DLQ).
    logger.warn('RingCentral disabled — dropping capture job')
    return 0
  }

  const job = JSON.parse(record.body) as CaptureJob
  if (!job.connectionId) {
    logger.warn('capture job without a connectionId — dropping', {
      webhookEventId: job.webhookEventId,
    })
    return 0
  }

  // Backfill-on-connect jobs (Unit 15) have no originating webhook event, so the
  // InboundWebhookEvent bookkeeping is conditional on webhookEventId being set.
  const { webhookEventId } = job
  try {
    const connection = await findConnectionById(db, job.connectionId)
    if (!connection) {
      logger.warn('capture job for unknown connection — dropping', {
        connectionId: job.connectionId,
      })
      if (webhookEventId) await markWebhookEventFailed(db, webhookEventId, 'connection not found')
      return 0
    }
    const { captured, emitted } = await syncConnection(
      db,
      connection,
      job.backfillDays != null ? { backfillDays: job.backfillDays } : {},
    )
    if (webhookEventId) await markWebhookEventProcessed(db, webhookEventId)
    logger.info('capture job processed', {
      webhookEventId,
      connectionId: job.connectionId,
      backfill: job.backfillDays != null,
      captured,
      emitted,
    })
    return emitted
  } catch (err) {
    // Record the failure on the event (if any), then rethrow so SQS retries / DLQs it.
    if (webhookEventId) {
      await markWebhookEventFailed(
        db,
        webhookEventId,
        err instanceof Error ? err.message : String(err),
      ).catch(() => {})
    }
    throw err
  }
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = []
  let emitted = 0
  for (const record of event.Records) {
    try {
      emitted += await processRecord(record)
    } catch (err) {
      logger.error('capture record failed — will retry', {
        messageId: record.messageId,
        error: err instanceof Error ? err.message : String(err),
      })
      batchItemFailures.push({ itemIdentifier: record.messageId })
    }
  }
  // Awaited: an un-awaited invoke is frozen when the handler returns. Never
  // throws, and is time-bounded, so it can't fail or stall the batch.
  if (emitted > 0) await kickTriggerDispatcher('sms_received')
  return { batchItemFailures }
}
