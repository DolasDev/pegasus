-- ---------------------------------------------------------------------------
-- Migration: 20260420120000_add_vpn_peers
--
-- Adds the `VpnPeer` and `VpnState` tables plus the `VpnStatus` enum used by
-- the multi-tenant WireGuard hub. One VpnPeer row per tenant (FK unique);
-- VpnState is a singleton whose `generation` counter is bumped on every peer
-- mutation and used as an ETag by the hub reconcile agent.
--
-- Only the tenant's public key is stored; the private key is returned once
-- in the generated client.conf and never persisted.
--
-- See plans/in-progress/wireguard-multi-tenant-vpn.md Appendix A.
-- ---------------------------------------------------------------------------

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "public"."VpnStatus" AS ENUM (
    'PENDING',
    'ACTIVE',
    'SUSPENDED',
    'REVOKED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable: VpnPeer
CREATE TABLE IF NOT EXISTS "public"."VpnPeer" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "assignedOctet1"  INTEGER NOT NULL,
  "assignedOctet2"  INTEGER NOT NULL,
  "publicKey"       TEXT NOT NULL,
  "status"          "public"."VpnStatus" NOT NULL DEFAULT 'PENDING',
  "lastHandshakeAt" TIMESTAMP(3),
  "rxBytes"         BIGINT NOT NULL DEFAULT 0,
  "txBytes"         BIGINT NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VpnPeer_pkey" PRIMARY KEY ("id")
);

-- CreateTable: VpnState (singleton)
CREATE TABLE IF NOT EXISTS "public"."VpnState" (
  "id"         INTEGER NOT NULL DEFAULT 1,
  "generation" INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT "VpnState_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "VpnPeer_tenantId_key"
  ON "public"."VpnPeer" ("tenantId");

CREATE INDEX IF NOT EXISTS "VpnPeer_status_idx"
  ON "public"."VpnPeer" ("status");

CREATE UNIQUE INDEX IF NOT EXISTS "VpnPeer_assignedOctet1_assignedOctet2_key"
  ON "public"."VpnPeer" ("assignedOctet1", "assignedOctet2");

-- Foreign key to tenants
DO $$ BEGIN
  ALTER TABLE "public"."VpnPeer"
    ADD CONSTRAINT "VpnPeer_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Seed singleton VpnState row. The admin handler bumps `generation` on every
-- peer mutation; the hub reconcile agent uses it as an ETag.
INSERT INTO "public"."VpnState" ("id", "generation") VALUES (1, 1) ON CONFLICT ("id") DO NOTHING;
