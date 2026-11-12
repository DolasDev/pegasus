-- AlterEnum: a step is an Automation started by an open durable Workflow.
ALTER TYPE "WorkflowExecutionTriggerSource" ADD VALUE 'WORKFLOW';

-- AlterTable: additive; existing rows stay NULL.
ALTER TABLE "workflow_executions" ADD COLUMN     "parent_execution_id" TEXT,
ADD COLUMN     "step_key" TEXT;

-- CreateIndex
CREATE INDEX "workflow_executions_parent_execution_id_idx" ON "workflow_executions"("parent_execution_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_executions_tenant_id_step_key_key" ON "workflow_executions"("tenant_id", "step_key");
