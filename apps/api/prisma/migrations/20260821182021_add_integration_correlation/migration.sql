-- CreateTable
CREATE TABLE "integration_correlations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "local_entity_type" TEXT NOT NULL,
    "local_entity_id" TEXT NOT NULL,
    "entity_key" TEXT NOT NULL,
    "updated_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_correlations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_correlations_tenant_id_integration_id_entity_ty_idx" ON "integration_correlations"("tenant_id", "integration_id", "entity_type");

-- CreateIndex
CREATE UNIQUE INDEX "integration_correlations_local_key" ON "integration_correlations"("tenant_id", "integration_id", "entity_type", "local_entity_type", "local_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_correlations_external_key" ON "integration_correlations"("tenant_id", "integration_id", "entity_type", "entity_key");

-- AddForeignKey
ALTER TABLE "integration_correlations" ADD CONSTRAINT "integration_correlations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
