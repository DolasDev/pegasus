-- CreateTable
CREATE TABLE "support_work_item_drafts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "through_message_id" TEXT,
    "through_message_at" TIMESTAMPTZ(6),
    "kind" VARCHAR(16),
    "severity" VARCHAR(8),
    "title" VARCHAR(200),
    "summary" TEXT,
    "repro_steps" TEXT,
    "expected" TEXT,
    "actual" TEXT,
    "suggested_reply" TEXT,
    "requested_by" VARCHAR(320) NOT NULL,
    "model_id" TEXT,
    "prompt_version" VARCHAR(64),
    "stop_reason" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_work_item_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_work_item_drafts_thread_id_created_at_idx" ON "support_work_item_drafts"("thread_id", "created_at");

-- AddForeignKey
ALTER TABLE "support_work_item_drafts" ADD CONSTRAINT "support_work_item_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_work_item_drafts" ADD CONSTRAINT "support_work_item_drafts_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "support_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Value guards Prisma can't express. The lists mirror SUPPORT_DRAFT_STATUSES,
-- SUPPORT_WORK_ITEM_KINDS and SUPPORT_SEVERITIES in @pegasus/domain.
ALTER TABLE "support_work_item_drafts" ADD CONSTRAINT "support_work_item_drafts_status_check"
    CHECK ("status" IN ('pending', 'running', 'ready', 'failed', 'dismissed'));

ALTER TABLE "support_work_item_drafts" ADD CONSTRAINT "support_work_item_drafts_kind_check"
    CHECK ("kind" IS NULL OR "kind" IN ('bug', 'investigation', 'feature', 'question'));

ALTER TABLE "support_work_item_drafts" ADD CONSTRAINT "support_work_item_drafts_severity_check"
    CHECK ("severity" IS NULL OR "severity" IN ('low', 'medium', 'high'));
