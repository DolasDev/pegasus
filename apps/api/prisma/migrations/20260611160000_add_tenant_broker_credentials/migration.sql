-- ---------------------------------------------------------------------------
-- Migration: 20260611160000_add_tenant_broker_credentials
--
-- Phase 3 Track A Unit 7 — per-tenant workflow-broker credentials (the
-- sandbox security keystone). Purely additive:
--   * new `tenant_broker_credentials` table — at most one row per tenant
--     (unique tenant_id), minted lazily by lib/tenant-broker-credential.ts
--     the first time a tenant's runner needs broker access.
--
-- Two at-rest forms of the same token, deliberately:
--   * token_hash       — SHA-256 hex of the full `wbk_...` token; the broker
--                        verifies against this and never needs plaintext back.
--   * token_ciphertext — KMS-encrypted plaintext (same key as
--                        workflows.runtime_token_ciphertext) so the Unit 9
--                        runner dispatcher can recover it at ECS task launch.
--
-- Nothing consumes the table yet beyond the broker's optional
-- X-Workflow-Broker-Token path (handlers/workflow-internal.ts) — the legacy
-- stdlib worker keeps using the shared secret unchanged. See
-- prisma/schema.prisma for model documentation.
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."tenant_broker_credentials" (
  "id"               TEXT NOT NULL,
  "tenant_id"        TEXT NOT NULL,
  "token_hash"       TEXT NOT NULL,
  "token_ciphertext" TEXT NOT NULL,
  "rotated_at"       TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tenant_broker_credentials_pkey" PRIMARY KEY ("id")
);

-- One credential per tenant — also the broker's lookup path (the tenantId is
-- embedded in the token, so verification is a unique-index hit, never a scan).
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_broker_credentials_tenant_id_key"
  ON "public"."tenant_broker_credentials" ("tenant_id");

-- Foreign key to tenants
DO $$ BEGIN
  ALTER TABLE "public"."tenant_broker_credentials"
    ADD CONSTRAINT "tenant_broker_credentials_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
