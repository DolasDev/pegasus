-- ---------------------------------------------------------------------------
-- Migration: 20260608180000_add_messaging
--
-- RingCentral SMS capture (Unit 2). Purely additive / expand-only:
--   * 9 new enums (direction, source, status, forward, token/health/sub/store/event)
--   * 6 new tables: ringcentral_connections, ringcentral_subscriptions,
--     ringcentral_sync_cursors, inbound_webhook_events, messages,
--     message_forward_outbox
--   * back-relation FKs to tenants (ON DELETE CASCADE)
--
-- Nothing reads these tables yet — capture/forwarding lands in later units.
-- Idempotent (IF NOT EXISTS / duplicate_object guards) so re-runs are safe.
-- See prisma/schema.prisma for model documentation.
-- ---------------------------------------------------------------------------

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "public"."MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."MessageSource" AS ENUM ('THREAD_STORE', 'V1_STORE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."MessageStatus" AS ENUM ('CAPTURED', 'FORWARDED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."ForwardStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'DEAD');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."RcTokenStatus" AS ENUM ('ACTIVE', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."RcConnectionHealth" AS ENUM ('HEALTHY', 'DEGRADED', 'UNHEALTHY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."RcSubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRING', 'BLACKLISTED', 'DEAD');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."RcSyncStore" AS ENUM ('THREAD', 'V1');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."WebhookEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateTable: ringcentral_connections
CREATE TABLE IF NOT EXISTS "public"."ringcentral_connections" (
  "id"                TEXT NOT NULL,
  "tenant_id"         TEXT NOT NULL,
  "rc_account_id"     TEXT NOT NULL,
  "rc_extension_id"   TEXT NOT NULL,
  "owner_number"      TEXT NOT NULL,
  "token_secret_arn"  TEXT,
  "token_status"      "public"."RcTokenStatus" NOT NULL DEFAULT 'ACTIVE',
  "scopes"            TEXT[],
  "last_refreshed_at" TIMESTAMPTZ(6),
  "health"            "public"."RcConnectionHealth" NOT NULL DEFAULT 'HEALTHY',
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "ringcentral_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ringcentral_connections_tenant_id_rc_account_id_rc_extensio_key"
  ON "public"."ringcentral_connections" ("tenant_id", "rc_account_id", "rc_extension_id");
CREATE INDEX IF NOT EXISTS "ringcentral_connections_tenant_id_idx"
  ON "public"."ringcentral_connections" ("tenant_id");

-- CreateTable: ringcentral_subscriptions
CREATE TABLE IF NOT EXISTS "public"."ringcentral_subscriptions" (
  "id"                 TEXT NOT NULL,
  "tenant_id"          TEXT NOT NULL,
  "connection_id"      TEXT NOT NULL,
  "subscription_id"    TEXT NOT NULL,
  "event_filters"      TEXT[],
  "transport"          TEXT NOT NULL DEFAULT 'WebHook',
  "delivery_address"   TEXT NOT NULL,
  "verification_token" TEXT NOT NULL,
  "expires_at"         TIMESTAMP(3) NOT NULL,
  "status"             "public"."RcSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "last_renewed_at"    TIMESTAMP(3),
  "failure_count"      INTEGER NOT NULL DEFAULT 0,
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "ringcentral_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ringcentral_subscriptions_subscription_id_key"
  ON "public"."ringcentral_subscriptions" ("subscription_id");
CREATE INDEX IF NOT EXISTS "ringcentral_subscriptions_tenant_id_idx"
  ON "public"."ringcentral_subscriptions" ("tenant_id");
CREATE INDEX IF NOT EXISTS "ringcentral_subscriptions_connection_id_idx"
  ON "public"."ringcentral_subscriptions" ("connection_id");
CREATE INDEX IF NOT EXISTS "ringcentral_subscriptions_status_expires_at_idx"
  ON "public"."ringcentral_subscriptions" ("status", "expires_at");

-- CreateTable: ringcentral_sync_cursors
CREATE TABLE IF NOT EXISTS "public"."ringcentral_sync_cursors" (
  "id"            TEXT NOT NULL,
  "tenant_id"     TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "store"         "public"."RcSyncStore" NOT NULL,
  "sync_token"    TEXT,
  "last_sync_at"  TIMESTAMP(3),
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "ringcentral_sync_cursors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ringcentral_sync_cursors_tenant_id_connection_id_store_key"
  ON "public"."ringcentral_sync_cursors" ("tenant_id", "connection_id", "store");
CREATE INDEX IF NOT EXISTS "ringcentral_sync_cursors_tenant_id_idx"
  ON "public"."ringcentral_sync_cursors" ("tenant_id");

-- CreateTable: inbound_webhook_events
CREATE TABLE IF NOT EXISTS "public"."inbound_webhook_events" (
  "id"              TEXT NOT NULL,
  "tenant_id"       TEXT NOT NULL,
  "subscription_id" TEXT,
  "connection_id"   TEXT,
  "raw_payload"     JSONB NOT NULL,
  "headers"         JSONB NOT NULL,
  "received_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "processed_at"    TIMESTAMPTZ(6),
  "status"          "public"."WebhookEventStatus" NOT NULL DEFAULT 'PENDING',
  "error"           TEXT,

  CONSTRAINT "inbound_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inbound_webhook_events_tenant_id_status_idx"
  ON "public"."inbound_webhook_events" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "inbound_webhook_events_received_at_idx"
  ON "public"."inbound_webhook_events" ("received_at");

-- CreateTable: messages
CREATE TABLE IF NOT EXISTS "public"."messages" (
  "id"                    TEXT NOT NULL,
  "tenant_id"             TEXT NOT NULL,
  "connection_id"         TEXT,
  "source"                "public"."MessageSource" NOT NULL,
  "external_id"           TEXT NOT NULL,
  "thread_id"             TEXT,
  "direction"             "public"."MessageDirection" NOT NULL,
  "from_number"           TEXT NOT NULL,
  "to_number"             TEXT NOT NULL,
  "body"                  TEXT,
  "rc_creation_time"      TIMESTAMPTZ(6) NOT NULL,
  "rc_last_modified_time" TIMESTAMPTZ(6),
  "status"                "public"."MessageStatus" NOT NULL DEFAULT 'CAPTURED',
  "forward_status"        "public"."ForwardStatus" NOT NULL DEFAULT 'PENDING',
  "body_purged_at"        TIMESTAMPTZ(6),
  "purge_after"           TIMESTAMPTZ(6),
  "captured_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "messages_tenant_id_source_external_id_key"
  ON "public"."messages" ("tenant_id", "source", "external_id");
CREATE INDEX IF NOT EXISTS "messages_tenant_id_forward_status_idx"
  ON "public"."messages" ("tenant_id", "forward_status");
CREATE INDEX IF NOT EXISTS "messages_tenant_id_rc_creation_time_idx"
  ON "public"."messages" ("tenant_id", "rc_creation_time");

-- CreateTable: message_forward_outbox
CREATE TABLE IF NOT EXISTS "public"."message_forward_outbox" (
  "id"              TEXT NOT NULL,
  "tenant_id"       TEXT NOT NULL,
  "message_id"      TEXT NOT NULL,
  "attempts"        INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "status"          "public"."ForwardStatus" NOT NULL DEFAULT 'PENDING',
  "last_error"      TEXT,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "message_forward_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "message_forward_outbox_message_id_key"
  ON "public"."message_forward_outbox" ("message_id");
CREATE INDEX IF NOT EXISTS "message_forward_outbox_tenant_id_status_next_attempt_at_idx"
  ON "public"."message_forward_outbox" ("tenant_id", "status", "next_attempt_at");

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "public"."ringcentral_connections"
    ADD CONSTRAINT "ringcentral_connections_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."ringcentral_subscriptions"
    ADD CONSTRAINT "ringcentral_subscriptions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."ringcentral_subscriptions"
    ADD CONSTRAINT "ringcentral_subscriptions_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "public"."ringcentral_connections"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."ringcentral_sync_cursors"
    ADD CONSTRAINT "ringcentral_sync_cursors_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."ringcentral_sync_cursors"
    ADD CONSTRAINT "ringcentral_sync_cursors_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "public"."ringcentral_connections"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."inbound_webhook_events"
    ADD CONSTRAINT "inbound_webhook_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."messages"
    ADD CONSTRAINT "messages_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."messages"
    ADD CONSTRAINT "messages_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "public"."ringcentral_connections"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."message_forward_outbox"
    ADD CONSTRAINT "message_forward_outbox_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."message_forward_outbox"
    ADD CONSTRAINT "message_forward_outbox_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
