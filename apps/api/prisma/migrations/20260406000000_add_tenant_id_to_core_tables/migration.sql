-- ---------------------------------------------------------------------------
-- Migration: 20260406000000_add_tenant_id_to_core_tables
--
-- Adds tenant_id (NOT NULL) to all core business tables that were created
-- in 0001_init without multi-tenant scoping. Also updates unique constraints
-- to be tenant-scoped and adds indexes for tenant_id columns.
--
-- Uses IF NOT EXISTS / IF EXISTS guards throughout so this migration is safe
-- to run against databases where the schema was already applied via db push.
-- ---------------------------------------------------------------------------

-- Helper: create a default tenant if none exists, so backfill has a valid FK target.
INSERT INTO "public"."tenants" ("id", "name", "slug", "updated_at")
SELECT 'default-tenant', 'Default', 'default', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "public"."tenants" LIMIT 1);

-- ---------------------------------------------------------------------------
-- 1. Add tenant_id columns (nullable first, then backfill, then NOT NULL)
--    ADD COLUMN IF NOT EXISTS makes this safe against Neon (already pushed).
-- ---------------------------------------------------------------------------

-- lead_sources
ALTER TABLE "public"."lead_sources" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "public"."lead_sources" SET "tenant_id" = (SELECT "id" FROM "public"."tenants" LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "public"."lead_sources" ALTER COLUMN "tenant_id" SET NOT NULL;

-- accounts
ALTER TABLE "public"."accounts" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "public"."accounts" SET "tenant_id" = (SELECT "id" FROM "public"."tenants" LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "public"."accounts" ALTER COLUMN "tenant_id" SET NOT NULL;

-- customers
ALTER TABLE "public"."customers" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "public"."customers" SET "tenant_id" = (SELECT "id" FROM "public"."tenants" LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "public"."customers" ALTER COLUMN "tenant_id" SET NOT NULL;

-- moves
ALTER TABLE "public"."moves" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "public"."moves" SET "tenant_id" = (SELECT "id" FROM "public"."tenants" LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "public"."moves" ALTER COLUMN "tenant_id" SET NOT NULL;

-- crew_members
ALTER TABLE "public"."crew_members" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "public"."crew_members" SET "tenant_id" = (SELECT "id" FROM "public"."tenants" LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "public"."crew_members" ALTER COLUMN "tenant_id" SET NOT NULL;

-- vehicles
ALTER TABLE "public"."vehicles" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "public"."vehicles" SET "tenant_id" = (SELECT "id" FROM "public"."tenants" LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "public"."vehicles" ALTER COLUMN "tenant_id" SET NOT NULL;

-- availabilities
ALTER TABLE "public"."availabilities" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "public"."availabilities" SET "tenant_id" = (SELECT "id" FROM "public"."tenants" LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "public"."availabilities" ALTER COLUMN "tenant_id" SET NOT NULL;

-- rate_tables
ALTER TABLE "public"."rate_tables" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "public"."rate_tables" SET "tenant_id" = (SELECT "id" FROM "public"."tenants" LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "public"."rate_tables" ALTER COLUMN "tenant_id" SET NOT NULL;

-- quotes
ALTER TABLE "public"."quotes" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "public"."quotes" SET "tenant_id" = (SELECT "id" FROM "public"."tenants" LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "public"."quotes" ALTER COLUMN "tenant_id" SET NOT NULL;

-- inventory_rooms
ALTER TABLE "public"."inventory_rooms" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "public"."inventory_rooms" SET "tenant_id" = (SELECT "id" FROM "public"."tenants" LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "public"."inventory_rooms" ALTER COLUMN "tenant_id" SET NOT NULL;

-- invoices
ALTER TABLE "public"."invoices" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "public"."invoices" SET "tenant_id" = (SELECT "id" FROM "public"."tenants" LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "public"."invoices" ALTER COLUMN "tenant_id" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Drop old single-column unique constraints, add tenant-scoped ones
-- ---------------------------------------------------------------------------

-- lead_sources: name -> (tenant_id, name)
DROP INDEX IF EXISTS "lead_sources_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "lead_sources_tenant_id_name_key" ON "public"."lead_sources"("tenant_id", "name");

-- accounts: name -> (tenant_id, name)
DROP INDEX IF EXISTS "accounts_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_tenant_id_name_key" ON "public"."accounts"("tenant_id", "name");

-- customers: email -> (tenant_id, email)
DROP INDEX IF EXISTS "customers_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS "customers_tenant_id_email_key" ON "public"."customers"("tenant_id", "email");

-- vehicles: registration_plate -> (tenant_id, registration_plate)
DROP INDEX IF EXISTS "vehicles_registration_plate_key";
CREATE UNIQUE INDEX IF NOT EXISTS "vehicles_tenant_id_registration_plate_key" ON "public"."vehicles"("tenant_id", "registration_plate");

-- rate_tables: name -> (tenant_id, name)
DROP INDEX IF EXISTS "rate_tables_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "rate_tables_tenant_id_name_key" ON "public"."rate_tables"("tenant_id", "name");

-- ---------------------------------------------------------------------------
-- 3. Add tenant_id indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "lead_sources_tenant_id_idx" ON "public"."lead_sources"("tenant_id");
CREATE INDEX IF NOT EXISTS "accounts_tenant_id_idx" ON "public"."accounts"("tenant_id");
CREATE INDEX IF NOT EXISTS "customers_tenant_id_idx" ON "public"."customers"("tenant_id");
CREATE INDEX IF NOT EXISTS "moves_tenant_id_idx" ON "public"."moves"("tenant_id");
CREATE INDEX IF NOT EXISTS "crew_members_tenant_id_idx" ON "public"."crew_members"("tenant_id");
CREATE INDEX IF NOT EXISTS "vehicles_tenant_id_idx" ON "public"."vehicles"("tenant_id");
CREATE INDEX IF NOT EXISTS "availabilities_tenant_id_idx" ON "public"."availabilities"("tenant_id");
CREATE INDEX IF NOT EXISTS "rate_tables_tenant_id_idx" ON "public"."rate_tables"("tenant_id");
CREATE INDEX IF NOT EXISTS "quotes_tenant_id_idx" ON "public"."quotes"("tenant_id");
CREATE INDEX IF NOT EXISTS "inventory_rooms_tenant_id_idx" ON "public"."inventory_rooms"("tenant_id");
CREATE INDEX IF NOT EXISTS "invoices_tenant_id_idx" ON "public"."invoices"("tenant_id");

-- ---------------------------------------------------------------------------
-- 4. Add foreign keys to tenants table
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE "public"."lead_sources" ADD CONSTRAINT "lead_sources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."accounts" ADD CONSTRAINT "accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."moves" ADD CONSTRAINT "moves_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."crew_members" ADD CONSTRAINT "crew_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."vehicles" ADD CONSTRAINT "vehicles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."availabilities" ADD CONSTRAINT "availabilities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."rate_tables" ADD CONSTRAINT "rate_tables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."quotes" ADD CONSTRAINT "quotes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."inventory_rooms" ADD CONSTRAINT "inventory_rooms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 5. Clean up: drop sso_provider_config added in 0002 but removed from schema
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."tenants" DROP COLUMN IF EXISTS "sso_provider_config";
