-- ---------------------------------------------------------------------------
-- Migration: 20260612120000_add_workflow_execution_tenant_created_index
--
-- Phase 3 Track A Unit 10 — run-path routing + execution limits.
-- Purely additive (CONCURRENT so it never takes a table lock in prod):
--
--   * workflow_executions(tenant_id, created_at) — composite index for the
--     per-tenant daily-quota count:
--       SELECT COUNT(*) FROM workflow_executions
--       WHERE tenant_id = $1 AND created_at >= $utcDayStart
--     The tenantId-first ordering scopes the scan to one tenant's rows;
--     created_at allows range filtering without a heap scan.
--
-- No new columns, no defaults, no constraint changes — safe to run against
-- the previous deployed API version (which does not use this index).
-- ---------------------------------------------------------------------------

-- CreateIndex (CONCURRENTLY = no full-table lock; acceptable to create outside
-- a transaction, which Prisma handles via a separate migration statement).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_executions_tenant_id_created_at_idx"
  ON "public"."workflow_executions" ("tenant_id", "created_at");
