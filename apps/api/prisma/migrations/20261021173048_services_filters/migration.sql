-- CreateTable
CREATE TABLE "services_filters" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "query" JSONB NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "services_filters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "services_filters_tenant_id_owner_id_idx" ON "services_filters"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "services_filters_tenant_id_is_public_idx" ON "services_filters"("tenant_id", "is_public");

-- AddForeignKey
ALTER TABLE "services_filters" ADD CONSTRAINT "services_filters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services_filters" ADD CONSTRAINT "services_filters_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
