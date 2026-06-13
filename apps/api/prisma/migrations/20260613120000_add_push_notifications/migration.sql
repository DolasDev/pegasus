-- ---------------------------------------------------------------------------
-- Migration: 20260613120000_add_push_notifications
--
-- Push notification infrastructure. Purely additive / expand-only:
--   * 1 new enum: DevicePlatform (IOS, ANDROID)
--   * 2 new tables: device_tokens, push_notification_outbox
--   * back-relation FKs to tenants / tenant_users / crew_members (ON DELETE CASCADE)
--
-- Reuses the existing ForwardStatus enum (PENDING/SENT/FAILED/DEAD) for the
-- outbox, matching message_forward_outbox. Idempotent (IF NOT EXISTS /
-- duplicate_object guards) so re-runs are safe. See prisma/schema.prisma for
-- model documentation.
-- ---------------------------------------------------------------------------

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "public"."DevicePlatform" AS ENUM ('IOS', 'ANDROID');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateTable: device_tokens
CREATE TABLE IF NOT EXISTS "public"."device_tokens" (
  "id"              TEXT NOT NULL,
  "tenant_id"       TEXT NOT NULL,
  "user_id"         TEXT NOT NULL,
  "platform"        "public"."DevicePlatform" NOT NULL,
  "expo_push_token" TEXT NOT NULL,
  "is_active"       BOOLEAN NOT NULL DEFAULT true,
  "last_seen_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "device_tokens_tenant_id_expo_push_token_key"
  ON "public"."device_tokens" ("tenant_id", "expo_push_token");
CREATE INDEX IF NOT EXISTS "device_tokens_tenant_id_user_id_is_active_idx"
  ON "public"."device_tokens" ("tenant_id", "user_id", "is_active");

-- CreateTable: push_notification_outbox
CREATE TABLE IF NOT EXISTS "public"."push_notification_outbox" (
  "id"              TEXT NOT NULL,
  "tenant_id"       TEXT NOT NULL,
  "user_id"         TEXT,
  "crew_member_id"  TEXT,
  "payload"         JSONB NOT NULL,
  "dedupe_key"      TEXT,
  "attempts"        INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "status"          "public"."ForwardStatus" NOT NULL DEFAULT 'PENDING',
  "last_error"      TEXT,
  "expo_ticket_id"  TEXT,
  "expo_receipt_id" TEXT,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "push_notification_outbox_pkey" PRIMARY KEY ("id")
);

-- NULL dedupe_key rows are distinct in Postgres, so ad-hoc sends are unconstrained
-- while non-null keys collapse retried enqueues for the same logical event.
CREATE UNIQUE INDEX IF NOT EXISTS "push_notification_outbox_tenant_id_dedupe_key_key"
  ON "public"."push_notification_outbox" ("tenant_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "push_notification_outbox_tenant_id_status_next_attempt_at_idx"
  ON "public"."push_notification_outbox" ("tenant_id", "status", "next_attempt_at");

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "public"."device_tokens"
    ADD CONSTRAINT "device_tokens_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."device_tokens"
    ADD CONSTRAINT "device_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."tenant_users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."push_notification_outbox"
    ADD CONSTRAINT "push_notification_outbox_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."push_notification_outbox"
    ADD CONSTRAINT "push_notification_outbox_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."tenant_users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."push_notification_outbox"
    ADD CONSTRAINT "push_notification_outbox_crew_member_id_fkey"
    FOREIGN KEY ("crew_member_id") REFERENCES "public"."crew_members"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
