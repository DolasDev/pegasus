-- DropIndex
DROP INDEX "workflow_secret_configs_tenant_id_kind_key_key";

-- AlterTable
ALTER TABLE "workflow_secret_configs" ADD COLUMN     "group_name" TEXT NOT NULL DEFAULT 'global';

-- CreateIndex
CREATE UNIQUE INDEX "workflow_secret_configs_tenant_id_kind_group_name_key_key" ON "workflow_secret_configs"("tenant_id", "kind", "group_name", "key");
