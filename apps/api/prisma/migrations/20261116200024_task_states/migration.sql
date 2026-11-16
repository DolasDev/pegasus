-- CreateTable
CREATE TABLE "task_states" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "task_key" VARCHAR(200) NOT NULL,
    "snoozed_until" TIMESTAMPTZ(6),
    "dismissed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "task_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_states_tenant_id_user_id_task_key_key" ON "task_states"("tenant_id", "user_id", "task_key");

-- AddForeignKey
ALTER TABLE "task_states" ADD CONSTRAINT "task_states_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_states" ADD CONSTRAINT "task_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
