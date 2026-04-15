-- ---------------------------------------------------------------------------
-- Migration: 20260414120000_add_documents
--
-- Adds the `documents` table and `DocumentStatus` enum used by the document
-- management system. Polymorphic — `entity_type` + `entity_id` reference any
-- bounded-context aggregate (customer, quote, move, invoice, …) without a FK.
--
-- The lifecycle is:
--   PENDING_UPLOAD → ACTIVE (via finalize endpoint)
--                  → ARCHIVED (hidden from default lists)
--                  → PENDING_DELETION (soft delete; purged by future worker)
-- ---------------------------------------------------------------------------

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "public"."DocumentStatus" AS ENUM (
    'PENDING_UPLOAD',
    'ACTIVE',
    'ARCHIVED',
    'PENDING_DELETION'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."documents" (
  "id"            TEXT NOT NULL,
  "tenant_id"     TEXT NOT NULL,
  "entity_type"   TEXT NOT NULL,
  "entity_id"     TEXT NOT NULL,
  "document_type" TEXT NOT NULL,
  "category"      TEXT,
  "s3_bucket"     TEXT NOT NULL,
  "s3_key"        TEXT NOT NULL,
  "filename"      TEXT NOT NULL,
  "mime_type"     TEXT NOT NULL,
  "size_bytes"    INTEGER NOT NULL,
  "status"        "public"."DocumentStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
  "uploaded_by"   TEXT NOT NULL,
  "expires_at"    TIMESTAMP(3),
  "deleted_at"    TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "documents_tenant_id_entity_type_entity_id_idx"
  ON "public"."documents" ("tenant_id", "entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "documents_tenant_id_document_type_idx"
  ON "public"."documents" ("tenant_id", "document_type");

CREATE INDEX IF NOT EXISTS "documents_tenant_id_status_idx"
  ON "public"."documents" ("tenant_id", "status");

-- Foreign key to tenants
DO $$ BEGIN
  ALTER TABLE "public"."documents"
    ADD CONSTRAINT "documents_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
