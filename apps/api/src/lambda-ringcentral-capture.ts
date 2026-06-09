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
// ---------------------------------------------------------------------------

import type { SQSEvent, SQSBatchResponse, SQSRecord } from 'aws-lambda'
import { db } from './db'
import { createLogger } from './lib/logger'
import { readOAuthConfig } from './services/ringcentral/oauth'
import { syncConnection } from './services/ringcentral/sync'
import {
  findConnectionById,
  markWebhookEventProcessed,
  markWebhookEventFailed,
} from './repositories/messaging.repository'
import type { CaptureJob } from './lib/ringcentral-queue'

const logger = createLogger('pegasus-ringcentral-capture')

async function processRecord(record: SQSRecord): Promise<void> {
  const config = readOAuthConfig()
  if (!config) {
    // Flag off — drop the job (don't fail the record into the DLQ).
    logger.warn('RingCentral disabled — dropping capture job')
    return
  }

  const job = JSON.parse(record.body) as CaptureJob
  if (!job.connectionId) {
    logger.warn('capture job without a connectionId — dropping', {
      webhookEventId: job.webhookEventId,
    })
    return
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
      return
    }
    const { captured } = await syncConnection(
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
    })
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
  for (const record of event.Records) {
    try {
      await processRecord(record)
    } catch (err) {
      logger.error('capture record failed — will retry', {
        messageId: record.messageId,
        error: err instanceof Error ? err.message : String(err),
      })
      batchItemFailures.push({ itemIdentifier: record.messageId })
    }
  }
  return { batchItemFailures }
}
