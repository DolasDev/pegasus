-- AlterTable
ALTER TABLE "integration_projections" ADD COLUMN     "fetched_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "integration_fetch_cache" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "records" JSONB NOT NULL,
    "record_count" INTEGER NOT NULL,
    "pages" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL,
    "status" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_fetch_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_fetch_cache_fetched_at_idx" ON "integration_fetch_cache"("fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_fetch_cache_key" ON "integration_fetch_cache"("tenant_id", "integration_id", "operation", "request_hash");

-- AddForeignKey
ALTER TABLE "integration_fetch_cache" ADD CONSTRAINT "integration_fetch_cache_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
