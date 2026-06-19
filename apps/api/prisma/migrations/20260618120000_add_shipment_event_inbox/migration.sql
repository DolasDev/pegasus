-- Migration: Add platform.shipment_event_inbox
-- Idempotent landing for legacy MoveManager shipment events relayed via SNS FIFO
-- → SQS FIFO. The consumer (lambda-shipment-event-consume) dedupes on
-- message_id; the row's presence is the at-least-once dedupe gate.

-- CreateTable: platform.shipment_event_inbox
CREATE TABLE IF NOT EXISTS "platform"."shipment_event_inbox" (
    "message_id" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at_utc" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMPTZ(6),

    CONSTRAINT "shipment_event_inbox_pkey" PRIMARY KEY ("message_id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "shipment_event_inbox_dispatched_at_occurred_at_utc_idx"
    ON "platform"."shipment_event_inbox"("dispatched_at", "occurred_at_utc");
