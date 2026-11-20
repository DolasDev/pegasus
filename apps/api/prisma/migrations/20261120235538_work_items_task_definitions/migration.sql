-- CreateEnum
CREATE TYPE "WorkItemStatus" AS ENUM ('open', 'blocked', 'done', 'cancelled');

-- CreateTable
CREATE TABLE "work_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_num" INTEGER NOT NULL,
    "task_type" VARCHAR(64) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000),
    "priority" VARCHAR(10) NOT NULL DEFAULT 'normal',
    "owning_role" VARCHAR(64) NOT NULL,
    "assignee_user_id" TEXT,
    "assignee_employee_code" INTEGER,
    "assignee_unresolved" VARCHAR(40),
    "status" "WorkItemStatus" NOT NULL DEFAULT 'open',
    "due_date" DATE,
    "dedup_key" VARCHAR(190),
    "request_hash" VARCHAR(64),
    "definition_key" VARCHAR(100),
    "definition_version" INTEGER,
    "close_reason" VARCHAR(1000),
    "closed_by_user_id" TEXT,
    "blocked_at" TIMESTAMPTZ(6),
    "block_reason" VARCHAR(500),
    "awaiting_execution_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "done_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),

    CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_definitions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "owning_role" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_items_tenant_id_order_num_idx" ON "work_items"("tenant_id", "order_num");

-- CreateIndex
CREATE INDEX "work_items_tenant_id_owning_role_status_due_date_idx" ON "work_items"("tenant_id", "owning_role", "status", "due_date");

-- CreateIndex
CREATE INDEX "work_items_tenant_id_task_type_status_idx" ON "work_items"("tenant_id", "task_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "work_items_tenant_id_dedup_key_key" ON "work_items"("tenant_id", "dedup_key");

-- CreateIndex
CREATE UNIQUE INDEX "task_definitions_tenant_id_key_version_key" ON "task_definitions"("tenant_id", "key", "version");

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_definitions" ADD CONSTRAINT "task_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
