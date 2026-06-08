// ---------------------------------------------------------------------------
// RingCentral capture queue (SQS) — producer side.
//
// The webhook fast-acks by persisting the raw event and enqueuing a small
// capture job; the capture worker (Unit 11) consumes it and runs the targeted
// sync pull. Enqueue is a no-op until RINGCENTRAL_WEBHOOK_QUEUE_URL is set
// (the queue is provisioned in Unit 11), so the webhook deploys before the
// queue exists — events still land in InboundWebhookEvent and the reconciliation
// sync remains the backstop.
// ---------------------------------------------------------------------------

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'

let _client: SQSClient | null = null
function client(): SQSClient {
  return (_client ??= new SQSClient({}))
}

export function __resetQueueClientForTests(): void {
  _client = null
}

/**
 * A capture job for the worker. Most originate from a webhook delivery
 * (`webhookEventId` set, `subscriptionId` present); a backfill-on-connect job
 * (Unit 15) has `webhookEventId: null` and carries `backfillDays` so the worker's
 * `syncConnection` does a full FSync window rather than the default. Either way
 * the worker just runs the idempotent dual-store sync for `connectionId`.
 */
export interface CaptureJob {
  webhookEventId: string | null
  tenantId: string
  connectionId: string | null
  subscriptionId?: string
  backfillDays?: number
}

/**
 * Enqueues a capture job if the queue is configured. Returns whether it was
 * sent. Never throws on a missing queue URL — the webhook must still fast-ack.
 */
export async function enqueueCapture(job: CaptureJob): Promise<boolean> {
  const queueUrl = process.env['RINGCENTRAL_WEBHOOK_QUEUE_URL']
  if (!queueUrl) return false
  await client().send(
    new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(job) }),
  )
  return true
}

/**
 * Enqueues a backfill-on-connect job: a webhook-less capture that triggers an
 * immediate full sync for a freshly-connected connection (no cursor yet → the
 * sync FSyncs both stores), instead of waiting for the reconciliation cron.
 * Reuses the capture queue/worker (Unit 11). No-op if the queue is unset.
 */
export async function enqueueBackfill(
  tenantId: string,
  connectionId: string,
  backfillDays?: number,
): Promise<boolean> {
  return enqueueCapture({
    webhookEventId: null,
    tenantId,
    connectionId,
    ...(backfillDays != null ? { backfillDays } : {}),
  })
}
