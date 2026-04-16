-- ---------------------------------------------------------------------------
-- Migration: 20260416120000_add_document_variants
--
-- Adds the `document_variants` table plus `DocumentVariantKind` and
-- `DocumentVariantStatus` enums used by the variant cache pipeline.
--
-- One row per (document, variant). The unique index on
-- (document_id, variant) is the entire concurrency story for the converter
-- Lambda: S3 event retries upsert idempotently.
-- ---------------------------------------------------------------------------

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "public"."DocumentVariantKind" AS ENUM (
    'THUMB',
    'WEB'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "public"."DocumentVariantStatus" AS ENUM (
    'PENDING',
    'READY',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."document_variants" (
  "id"             TEXT NOT NULL,
  "document_id"    TEXT NOT NULL,
  "variant"        "public"."DocumentVariantKind" NOT NULL,
  "status"         "public"."DocumentVariantStatus" NOT NULL DEFAULT 'PENDING',
  "s3_key"         TEXT,
  "size_bytes"     INTEGER,
  "width"          INTEGER,
  "height"         INTEGER,
  "failure_reason" TEXT,
  "generated_at"   TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "document_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "document_variants_document_id_variant_key"
  ON "public"."document_variants"("document_id", "variant");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "document_variants_status_idx"
  ON "public"."document_variants"("status");

-- AddForeignKey
ALTER TABLE "public"."document_variants"
  ADD CONSTRAINT "document_variants_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
