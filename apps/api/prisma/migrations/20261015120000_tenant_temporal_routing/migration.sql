-- Phase 3b.2 — route tenant Automations to their own Temporal namespace.
-- Purely additive: three enum values for the cutover state machine and one
-- nullable column recording which namespace an execution was started in
-- (null = the shared namespace, which every existing row used).

-- AlterEnum
ALTER TYPE "TenantTemporalNamespaceStatus" ADD VALUE 'DRAINING';
ALTER TYPE "TenantTemporalNamespaceStatus" ADD VALUE 'ACTIVE';
ALTER TYPE "TenantTemporalNamespaceStatus" ADD VALUE 'REVERTING';

-- AlterTable
ALTER TABLE "workflow_executions" ADD COLUMN     "temporal_namespace" TEXT;
