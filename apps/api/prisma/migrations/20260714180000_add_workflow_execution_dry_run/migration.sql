-- AlterTable
ALTER TABLE "public"."workflow_executions" ADD COLUMN "dry_run" BOOLEAN NOT NULL DEFAULT false;
