-- CreateEnum
CREATE TYPE "IntegrationConfigVisibility" AS ENUM ('GLOBAL', 'TENANT');

-- CreateEnum
CREATE TYPE "IntegrationConfigStatus" AS ENUM ('PUBLISHED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "integration_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "visibility" "IntegrationConfigVisibility" NOT NULL DEFAULT 'TENANT',
    "status" "IntegrationConfigStatus" NOT NULL DEFAULT 'PUBLISHED',
    "mapping" JSONB NOT NULL,
    "rules" JSONB NOT NULL,
    "corpus" JSONB NOT NULL,
    "gate_report" JSONB NOT NULL,
    "published_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_configs_integration_id_visibility_idx" ON "integration_configs"("integration_id", "visibility");

-- CreateIndex
CREATE INDEX "integration_configs_tenant_id_idx" ON "integration_configs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_configs_integration_id_tenant_id_version_key" ON "integration_configs"("integration_id", "tenant_id", "version");

-- AddForeignKey
ALTER TABLE "integration_configs" ADD CONSTRAINT "integration_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
