-- ---------------------------------------------------------------------------
-- Migration: 20260611120000_add_workflow_artifact_integrity
--
-- Phase 3 Track A Unit 6 — artifact integrity + execution eligibility.
-- Purely additive:
--   * workflows.artifact_sha256     — hex SHA-256 of the artifact zip,
--                                     computed server-side at finalize
--   * workflows.artifact_size_bytes — zip size recorded alongside the digest
--   * workflows.executable          — true when the artifact passed integrity
--                                     validation (zip structure, entry-point
--                                     resolution, no pip deps, 10 MB cap)
--
-- All pre-existing rows stay valid: integrity columns are nullable and
-- executable defaults to false (rows become executable on re-upload; the
-- stdlib refreshes on its next publish). Nothing executes differently yet —
-- the run path keeps the curated-names gate until Unit 10. See
-- prisma/schema.prisma for model documentation.
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."workflows"
  ADD COLUMN IF NOT EXISTS "artifact_sha256" TEXT,
  ADD COLUMN IF NOT EXISTS "artifact_size_bytes" INTEGER,
  ADD COLUMN IF NOT EXISTS "executable" BOOLEAN NOT NULL DEFAULT false;
