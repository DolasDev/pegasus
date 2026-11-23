/*
  Warnings:

  - You are about to drop the column `awaiting_execution_id` on the `work_items` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "TaskStore" AS ENUM ('legacy', 'cloud');

-- CreateEnum
CREATE TYPE "TaskAwaitStatus" AS ENUM ('waiting', 'delivered', 'abandoned');

-- AlterTable
ALTER TABLE "work_items" DROP COLUMN "awaiting_execution_id";

-- CreateTable
CREATE TABLE "task_awaits" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "store" "TaskStore" NOT NULL,
    "task_id" VARCHAR(64) NOT NULL,
    "order_num" INTEGER NOT NULL,
    "status" "TaskAwaitStatus" NOT NULL DEFAULT 'waiting',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "next_poll_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "task_awaits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_awaits_tenant_id_status_store_next_poll_at_idx" ON "task_awaits"("tenant_id", "status", "store", "next_poll_at");

-- CreateIndex
CREATE INDEX "task_awaits_tenant_id_store_task_id_status_idx" ON "task_awaits"("tenant_id", "store", "task_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "task_awaits_execution_id_store_task_id_key" ON "task_awaits"("execution_id", "store", "task_id");

-- AddForeignKey
ALTER TABLE "task_awaits" ADD CONSTRAINT "task_awaits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_awaits" ADD CONSTRAINT "task_awaits_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "workflow_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
