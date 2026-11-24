-- CreateTable
CREATE TABLE "support_threads" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "opened_by_user_id" TEXT NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "open_client_message_id" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'awaiting_operator',
    "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_author_kind" VARCHAR(16) NOT NULL DEFAULT 'customer',
    "last_operator_alert_at" TIMESTAMPTZ(6),
    "customer_last_read_at" TIMESTAMPTZ(6),
    "operator_last_read_at" TIMESTAMPTZ(6),
    "page_url" VARCHAR(2000),
    "user_agent" VARCHAR(500),
    "app_version" VARCHAR(50),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "author_kind" VARCHAR(16) NOT NULL,
    "author_user_id" TEXT,
    "operator_sub" TEXT,
    "operator_email" TEXT,
    "client_message_id" VARCHAR(64) NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_threads_tenant_id_opened_by_user_id_last_message_at_idx" ON "support_threads"("tenant_id", "opened_by_user_id", "last_message_at");

-- CreateIndex
CREATE INDEX "support_threads_status_last_message_at_idx" ON "support_threads"("status", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_threads_opened_by_user_id_open_client_message_id_key" ON "support_threads"("opened_by_user_id", "open_client_message_id");

-- CreateIndex
CREATE INDEX "support_messages_thread_id_created_at_idx" ON "support_messages"("thread_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_messages_thread_id_author_kind_client_message_id_key" ON "support_messages"("thread_id", "author_kind", "client_message_id");

-- AddForeignKey
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_opened_by_user_id_fkey" FOREIGN KEY ("opened_by_user_id") REFERENCES "tenant_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "support_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Value guards Prisma can't express (same approach as labor_crews). The lists
-- mirror SUPPORT_THREAD_STATUSES / SUPPORT_AUTHOR_KINDS in @pegasus/domain.
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_status_check"
    CHECK ("status" IN ('awaiting_operator', 'awaiting_customer', 'resolved'));

ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_last_author_kind_check"
    CHECK ("last_author_kind" IN ('customer', 'operator'));

-- An operator message carries the operator's Cognito sub and no tenant user; a
-- customer message never carries an operator sub (its author_user_id may be
-- nulled later if the user row is deleted).
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_check"
    CHECK (
        ("author_kind" = 'customer' AND "operator_sub" IS NULL)
        OR ("author_kind" = 'operator' AND "operator_sub" IS NOT NULL AND "author_user_id" IS NULL)
    );
