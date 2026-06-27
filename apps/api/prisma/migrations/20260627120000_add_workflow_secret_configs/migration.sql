-- CreateEnum
CREATE TYPE "WorkflowSecretConfigKind" AS ENUM ('SECRET', 'CONFIG');

-- CreateTable
CREATE TABLE "workflow_secret_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" "WorkflowSecretConfigKind" NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "value_ciphertext" TEXT,
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_secret_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_secret_configs_tenant_id_kind_idx" ON "workflow_secret_configs"("tenant_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_secret_configs_tenant_id_kind_key_key" ON "workflow_secret_configs"("tenant_id", "kind", "key");

-- AddForeignKey
ALTER TABLE "workflow_secret_configs" ADD CONSTRAINT "workflow_secret_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
