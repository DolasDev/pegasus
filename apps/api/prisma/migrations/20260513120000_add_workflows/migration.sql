-- ---------------------------------------------------------------------------
-- Migration: 20260513120000_add_workflows
--
-- Adds the `workflows` table, the `WorkflowVisibility` enum, and the
-- `is_platform_tenant` flag on `tenants`. See prisma/schema.prisma for the
-- model documentation and apps/api/src/handlers/workflows.ts for the upload
-- flow that populates this table.
--
-- Visibility is derived server-side at upload time from the uploading
-- principal's tenant: platform tenant → GLOBAL, everyone else → TENANT.
-- A unique constraint on (tenant_id, name, version) makes uploads immutable.
-- ---------------------------------------------------------------------------

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "public"."WorkflowVisibility" AS ENUM (
    'GLOBAL',
    'TENANT'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add is_platform_tenant flag to tenants
ALTER TABLE "public"."tenants"
  ADD COLUMN IF NOT EXISTS "is_platform_tenant" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."workflows" (
  "id"                  TEXT NOT NULL,
  "tenant_id"           TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "version"             TEXT NOT NULL,
  "visibility"          "public"."WorkflowVisibility" NOT NULL DEFAULT 'TENANT',
  "artifact_key"        TEXT NOT NULL,
  "manifest"            JSONB NOT NULL,
  "created_by_user_id"  TEXT NOT NULL,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "workflows_tenant_id_name_version_key"
  ON "public"."workflows" ("tenant_id", "name", "version");

CREATE INDEX IF NOT EXISTS "workflows_tenant_id_idx"
  ON "public"."workflows" ("tenant_id");

CREATE INDEX IF NOT EXISTS "workflows_visibility_idx"
  ON "public"."workflows" ("visibility");

-- Foreign key to tenants
DO $$ BEGIN
  ALTER TABLE "public"."workflows"
    ADD CONSTRAINT "workflows_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
