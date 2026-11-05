-- CreateEnum
CREATE TYPE "WorkflowKind" AS ENUM ('AUTOMATION', 'WORKFLOW');

-- AlterTable
ALTER TABLE "workflow_executions" ADD COLUMN     "reconciled_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "workflows" ADD COLUMN     "kind" "WorkflowKind" NOT NULL DEFAULT 'AUTOMATION';

-- CreateIndex
CREATE INDEX "workflow_executions_status_reconciled_at_idx" ON "workflow_executions"("status", "reconciled_at");
