-- ---------------------------------------------------------------------------
-- Migration: 20260519160000_add_workflow_executions
--
-- Phase 2 Unit 1 — execution schema + manifest foundation. Purely additive:
--   * new `workflow_executions` table + `WorkflowExecutionStatus` enum
--   * four new nullable columns on `workflows` (fork lineage + runtime
--     service-account credentials)
--
-- Nothing reads the new columns yet — Phase-1 workflow uploads are unaffected.
-- See prisma/schema.prisma for model documentation.
-- ---------------------------------------------------------------------------

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "public"."WorkflowExecutionStatus" AS ENUM (
    'QUEUED',
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'TIMED_OUT',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add fork-lineage + runtime service-account columns to workflows
ALTER TABLE "public"."workflows"
  ADD COLUMN IF NOT EXISTS "forked_from_workflow_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "forked_from_version"       TEXT,
  ADD COLUMN IF NOT EXISTS "runtime_token_ciphertext"  TEXT,
  ADD COLUMN IF NOT EXISTS "runtime_api_client_id"     TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."workflow_executions" (
  "id"                    TEXT NOT NULL,
  "tenant_id"             TEXT NOT NULL,
  "workflow_id"           TEXT NOT NULL,
  "status"                "public"."WorkflowExecutionStatus" NOT NULL DEFAULT 'QUEUED',
  "input"                 JSONB NOT NULL,
  "result"                JSONB,
  "error_message"         TEXT,
  "temporal_workflow_id"  TEXT,
  "temporal_run_id"       TEXT,
  "triggered_by_user_id"  TEXT NOT NULL,
  "queued_at"             TIMESTAMP(3) NOT NULL,
  "started_at"            TIMESTAMP(3),
  "finished_at"           TIMESTAMP(3),
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workflow_executions_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "workflow_executions_tenant_id_workflow_id_idx"
  ON "public"."workflow_executions" ("tenant_id", "workflow_id");

CREATE INDEX IF NOT EXISTS "workflow_executions_status_idx"
  ON "public"."workflow_executions" ("status");

-- Foreign key to workflows
DO $$ BEGIN
  ALTER TABLE "public"."workflow_executions"
    ADD CONSTRAINT "workflow_executions_workflow_id_fkey"
    FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
