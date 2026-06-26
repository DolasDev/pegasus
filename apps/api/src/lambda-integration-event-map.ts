// ---------------------------------------------------------------------------
// SQS consumer — pegII integration-event mapper.
//
// The on-prem Pegasus.Outbox.Relay publishes legacy MoveManager events to the
// `pegasus-{env}-integration-events` EventBridge bus; a `source: pegii.*` rule
// routes them to the buffer queue this worker drains. For each event it writes
// a tenant-scoped DomainEvent into the outbox, which the workflow-trigger
// dispatcher then matches against WorkflowTrigger.filter and starts workflows —
// so legacy events light up workflows with ZERO new trigger code.
//
// Legacy events now carry a Pegasus tenantId: the per-site relay stamps it from
// appsettings (the retired SNS-era consumer could not, as events were tenantless).
// We validate it is a real, ACTIVE tenant before emitting (a bad tenantId is a
// poison message — it retries then dead-letters, surfaced by the buffer-DLQ
// alarm).
//
// Idempotency (EventBridge is at-least-once) AND cutover-safety reuse the
// shipment_event_inbox ledger keyed on the legacy event id:
//   1. ensure an inbox row exists (create-if-absent; a duplicate is a no-op),
//   2. atomically CLAIM dispatch via updateMany(dispatchedAt: null) and emit the
//      DomainEvent only if WE won the claim.
// The conditional claim mirrors the dispatcher's own stamp pattern, so concurrent
// re-deliveries (and any inbox row the SNS consumer ingested but never
// dispatched during the cutover window) yield exactly one DomainEvent.
//
// Plan: plans/in-progress/pegii-eventbridge-integration.md (unit 4)
// ---------------------------------------------------------------------------

import type { SQSEvent, SQSBatchResponse, SQSRecord } from 'aws-lambda'
import { Prisma } from '@prisma/client'
import { db } from './db'
import { emitTenantEvent } from './lib/domain-events'
import { createLogger } from './lib/logger'

const logger = createLogger('pegasus-integration-event-map')

/** The pegII event envelope carried in the EventBridge `detail`. */
type IntegrationEventDetail = {
  tenantId: string
  /** Legacy dbo.Outbox row id — the idempotency key. */
  eventId: string
  schemaVersion: number
  occurredAt: string
  payload: Record<string, unknown>
}

/** The EventBridge event JSON, delivered verbatim as the SQS message body. */
type EventBridgeEnvelope = {
  'detail-type': string
  source: string
  detail: IntegrationEventDetail
}

type ParsedEvent = {
  detailType: string
  source: string
  detail: IntegrationEventDetail
}

function parseEvent(record: SQSRecord): ParsedEvent {
  const envelope = JSON.parse(record.body) as EventBridgeEnvelope
  const detailType = envelope['detail-type']
  const detail = envelope.detail
  if (
    !detailType ||
    !envelope.source ||
    !detail ||
    !detail.tenantId ||
    !detail.eventId ||
    typeof detail.schemaVersion !== 'number' ||
    !detail.occurredAt ||
    typeof detail.payload !== 'object' ||
    detail.payload === null
  ) {
    throw new Error('malformed integration event — missing required envelope/detail fields')
  }
  return { detailType, source: envelope.source, detail }
}

/** `Shipment.Opened` → `pegii.shipment.opened` (the DomainEvent taxonomy name). */
export function deriveEventType(detailType: string): string {
  return `pegii.${detailType.toLowerCase()}`
}

async function processRecord(record: SQSRecord): Promise<void> {
  const { detailType, source, detail } = parseEvent(record)
  const { tenantId, eventId, schemaVersion, occurredAt, payload } = detail

  // Tenant must be real + ACTIVE (SUSPENDED/OFFBOARDED/deleted → poison → DLQ).
  const tenant = await db.tenant.findFirst({
    where: { id: tenantId, status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  })
  if (!tenant) {
    throw new Error(`integration event ${eventId}: tenant ${tenantId} is not a known ACTIVE tenant`)
  }

  const eventType = deriveEventType(detailType)
  const aggregateType = detailType.split('.')[0] ?? detailType
  const aggregateId = String(payload['code'] ?? eventId)

  // 1. Ensure the ingest/idempotency ledger row exists (dispatchedAt stays null).
  try {
    await db.shipmentEventInbox.create({
      data: {
        messageId: eventId,
        aggregateType,
        aggregateId,
        eventType: detailType,
        schemaVersion,
        source,
        payload: payload as Prisma.InputJsonValue,
        occurredAtUtc: new Date(occurredAt),
      },
    })
  } catch (err) {
    // Unique violation on the message_id PK = at-least-once re-delivery, or a row
    // the SNS consumer already ingested. Not an error — fall through to claim.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
      throw err
    }
  }

  // 2. Atomically claim the dispatch and emit the DomainEvent only if we won.
  await db.$transaction(async (tx) => {
    const claimed = await tx.shipmentEventInbox.updateMany({
      where: { messageId: eventId, dispatchedAt: null },
      data: { dispatchedAt: new Date() },
    })
    if (claimed.count === 0) {
      // Another delivery already emitted the DomainEvent for this event id.
      return
    }
    await emitTenantEvent(tx, { tenantId, eventType, payload })
    logger.info('integration event mapped to domain event', {
      eventId,
      tenantId,
      eventType,
    })
  })
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = []
  for (const record of event.Records) {
    try {
      await processRecord(record)
    } catch (err) {
      logger.error('integration event record failed — will retry', {
        messageId: record.messageId,
        error: err instanceof Error ? err.message : String(err),
      })
      batchItemFailures.push({ itemIdentifier: record.messageId })
    }
  }
  return { batchItemFailures }
}
