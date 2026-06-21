-- CreateTable
CREATE TABLE "tenant_event_types" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "payload_schema" JSONB,
    "domain_condition" JSONB,
    "has_domain_condition" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_event_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_event_types_tenant_id_enabled_idx" ON "tenant_event_types"("tenant_id", "enabled");

-- CreateIndex
CREATE INDEX "tenant_event_types_has_domain_condition_enabled_idx" ON "tenant_event_types"("has_domain_condition", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_event_types_tenant_id_name_key" ON "tenant_event_types"("tenant_id", "name");

-- AddForeignKey
ALTER TABLE "tenant_event_types" ADD CONSTRAINT "tenant_event_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
