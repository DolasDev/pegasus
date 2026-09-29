-- CreateTable
CREATE TABLE "workflow_states" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_states_tenant_id_namespace_updated_at_idx" ON "workflow_states"("tenant_id", "namespace", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_states_key" ON "workflow_states"("tenant_id", "namespace", "key");

-- AddForeignKey
ALTER TABLE "workflow_states" ADD CONSTRAINT "workflow_states_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
