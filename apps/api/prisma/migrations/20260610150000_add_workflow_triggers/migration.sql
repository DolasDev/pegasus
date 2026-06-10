-- ---------------------------------------------------------------------------
-- Migration: 20260610150000_add_workflow_triggers
--
-- Phase 3 Track B Unit 2 — WorkflowTrigger schema + execution provenance.
-- Additive apart from one constraint relaxation:
--   * new `workflow_triggers` table + `WorkflowTriggerKind` enum
--   * new `WorkflowExecutionTriggerSource` enum + provenance columns on
--     `workflow_executions` (trigger_source, triggered_by_trigger_id)
--   * `workflow_executions.triggered_by_user_id` becomes nullable —
--     trigger-fired executions (Units 3/4) have no user; existing rows keep
--     their value and the manual run path keeps writing it.
--
-- Nothing fires triggers yet: EVENT rows wait for the Unit 3 dispatcher,
-- SCHEDULE rows wait for Unit 4 (Temporal Schedules). See
-- prisma/schema.prisma for model documentation.
-- ---------------------------------------------------------------------------

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "public"."WorkflowTriggerKind" AS ENUM (
    'EVENT',
    'SCHEDULE'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "public"."WorkflowExecutionTriggerSource" AS ENUM (
    'USER',
    'EVENT',
    'SCHEDULE'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Execution provenance: relax triggered_by_user_id, add source columns
ALTER TABLE "public"."workflow_executions"
  ALTER COLUMN "triggered_by_user_id" DROP NOT NULL;

ALTER TABLE "public"."workflow_executions"
  ADD COLUMN IF NOT EXISTS "trigger_source" "public"."WorkflowExecutionTriggerSource" NOT NULL DEFAULT 'USER',
  ADD COLUMN IF NOT EXISTS "triggered_by_trigger_id" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."workflow_triggers" (
  "id"                  TEXT NOT NULL,
  "tenant_id"           TEXT NOT NULL,
  "workflow_id"         TEXT NOT NULL,
  "kind"                "public"."WorkflowTriggerKind" NOT NULL,
  "event_type"          TEXT,
  "filter"              JSONB,
  "cron_expression"     TEXT,
  "enabled"             BOOLEAN NOT NULL DEFAULT true,
  "created_by_user_id"  TEXT NOT NULL,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workflow_triggers_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "workflow_triggers_tenant_id_workflow_id_idx"
  ON "public"."workflow_triggers" ("tenant_id", "workflow_id");

CREATE INDEX IF NOT EXISTS "workflow_triggers_kind_enabled_event_type_idx"
  ON "public"."workflow_triggers" ("kind", "enabled", "event_type");

-- Foreign key to tenants
DO $$ BEGIN
  ALTER TABLE "public"."workflow_triggers"
    ADD CONSTRAINT "workflow_triggers_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Foreign key to workflows — CASCADE so a deleted workflow's triggers go too
DO $$ BEGIN
  ALTER TABLE "public"."workflow_triggers"
    ADD CONSTRAINT "workflow_triggers_workflow_id_fkey"
    FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
