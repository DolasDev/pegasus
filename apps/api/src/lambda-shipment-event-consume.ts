// ---------------------------------------------------------------------------
// SQS consumer — legacy shipment-event ingest.
//
// The on-prem Pegasus.Outbox.Relay drains the legacy MoveManager `dbo.Outbox`
// table and publishes Shipment.Opened / Shipment.Closed to an SNS FIFO topic,
// which fans out to an SQS FIFO queue. This worker drains that queue and lands
// each event in `platform.shipment_event_inbox`.
//
// Delivery is at-least-once (the relay's durable-publish contract), so the
// consumer dedupes on the relay's `messageId`: the inbox row's primary key. A
// re-delivery of an already-accepted message is a no-op success — the row's
// presence IS the dedupe gate (mirrors how lambda-ringcentral-capture converges
// on a unique upsert). Uses partial-batch-response so only genuinely failed
// records are retried (and eventually dead-lettered) by SQS.
//
// Onward dispatch (fan-out to a partner consumer, mapping to a Pegasus tenant,
// etc.) is a later slice: see the `dispatchedAt` hook on the inbox model. We do
// NOT emit a cloud DomainEvent here — that taxonomy requires a tenantId, and
// legacy MoveManager events carry no Pegasus tenant id (per-site).
// ---------------------------------------------------------------------------

import type { SQSEvent, SQSBatchResponse, SQSRecord } from 'aws-lambda'
import { Prisma } from '@prisma/client'
import { db } from './db'
import { createLogger } from './lib/logger'

const logger = createLogger('pegasus-shipment-event-consume')

/** The event body the relay publishes as the SNS `Message`. */
type ShipmentEventMessage = {
  messageId: string
  aggregateType: string
  aggregateId: string
  eventType: string
  schemaVersion: number
  payload: unknown
  occurredAtUtc: string
}

/** The SNS notification envelope wrapping the published message (raw delivery off). */
type SnsEnvelope = {
  Message: string
  MessageAttributes?: Record<string, { Type: string; Value: string }>
}

function parseEvent(record: SQSRecord): {
  event: ShipmentEventMessage
  source: string
} {
  const envelope = JSON.parse(record.body) as SnsEnvelope
  const event = JSON.parse(envelope.Message) as ShipmentEventMessage
  if (
    !event.messageId ||
    !event.eventType ||
    !event.aggregateType ||
    !event.aggregateId ||
    typeof event.schemaVersion !== 'number' ||
    !event.occurredAtUtc
  ) {
    throw new Error('malformed shipment event — missing required fields')
  }
  const source = envelope.MessageAttributes?.['source']?.Value ?? 'unknown'
  return { event, source }
}

async function processRecord(record: SQSRecord): Promise<void> {
  const { event, source } = parseEvent(record)
  try {
    await db.shipmentEventInbox.create({
      data: {
        messageId: event.messageId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        schemaVersion: event.schemaVersion,
        source,
        payload: event.payload as Prisma.InputJsonValue,
        occurredAtUtc: new Date(event.occurredAtUtc),
      },
    })
    logger.info('shipment event ingested', {
      messageId: event.messageId,
      eventType: event.eventType,
      aggregateId: event.aggregateId,
    })
  } catch (err) {
    // Unique violation on the message_id PK = at-least-once re-delivery of an
    // already-accepted event. Ack as success; do not reprocess or DLQ.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.info('duplicate shipment event — already ingested', {
        messageId: event.messageId,
      })
      return
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
      logger.error('shipment event record failed — will retry', {
        messageId: record.messageId,
        error: err instanceof Error ? err.message : String(err),
      })
      batchItemFailures.push({ itemIdentifier: record.messageId })
    }
  }
  return { batchItemFailures }
}
