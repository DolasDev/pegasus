-- ---------------------------------------------------------------------------
-- Migration: 20260610120000_add_domain_events
--
-- Phase 3 Track B Unit 1 — transactional domain-event outbox. Purely additive:
--   * new `domain_events` table
--
-- Rows are written by emitDomainEvent() inside the same transaction as the
-- domain state change. Nothing consumes the table yet — the Phase 3 trigger
-- dispatcher will drain undispatched rows in (dispatched_at, occurred_at)
-- order. See prisma/schema.prisma for model documentation.
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."domain_events" (
  "id"            TEXT NOT NULL,
  "tenant_id"     TEXT NOT NULL,
  "event_type"    TEXT NOT NULL,
  "payload"       JSONB NOT NULL,
  "occurred_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatched_at" TIMESTAMP(3),

  CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "domain_events_dispatched_at_occurred_at_idx"
  ON "public"."domain_events" ("dispatched_at", "occurred_at");

CREATE INDEX IF NOT EXISTS "domain_events_tenant_id_idx"
  ON "public"."domain_events" ("tenant_id");

-- Foreign key to tenants
DO $$ BEGIN
  ALTER TABLE "public"."domain_events"
    ADD CONSTRAINT "domain_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
