-- ---------------------------------------------------------------------------
-- Migration: 20260612180000_add_tenant_workflows_disabled
--
-- Phase 3 Unit 11 — UX + operational guardrails.
-- Adds a per-tenant kill switch for workflow execution.
--
--   * tenants.workflows_disabled (Boolean, default false) — when true the
--     platform operator has disabled all workflow execution for this tenant.
--     Enforcement points:
--       1. POST /workflows/:id/run — returns 423 WORKFLOWS_DISABLED
--       2. Trigger dispatcher — skips firing for disabled tenants
--       3. ensureTenantRunner / sweepTenantRunners — refuses to launch runners
--     Existing RUNNING executions are allowed to finish; only NEW starts are
--     blocked. Toggle via POST /api/admin/tenants/:id/disable-workflows and
--     POST /api/admin/tenants/:id/enable-workflows.
--
-- Purely additive — safe to run against the previous API version (which does
-- not read this column).
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."tenants"
  ADD COLUMN IF NOT EXISTS "workflows_disabled" BOOLEAN NOT NULL DEFAULT false;
