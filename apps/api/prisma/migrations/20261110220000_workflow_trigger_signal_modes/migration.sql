-- CreateEnum
CREATE TYPE "WorkflowTriggerMode" AS ENUM ('NEW', 'START', 'DELIVER');

-- AlterTable: additive; every existing trigger keeps today's behaviour (NEW).
ALTER TABLE "workflow_triggers" ADD COLUMN     "correlation_path" TEXT,
ADD COLUMN     "mode" "WorkflowTriggerMode" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "signal_name" TEXT;

-- CreateIndex
CREATE INDEX "workflow_executions_tenant_id_temporal_workflow_id_idx" ON "workflow_executions"("tenant_id", "temporal_workflow_id");
