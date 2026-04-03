-- CreateTable
CREATE TABLE "public"."api_clients" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_key_hash_key" ON "public"."api_clients"("key_hash");

-- CreateIndex
CREATE INDEX "api_clients_key_prefix_idx" ON "public"."api_clients"("key_prefix");

-- CreateIndex
CREATE INDEX "api_clients_tenant_id_idx" ON "public"."api_clients"("tenant_id");

-- AddForeignKey
ALTER TABLE "public"."api_clients" ADD CONSTRAINT "api_clients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."api_clients" ADD CONSTRAINT "api_clients_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."tenant_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
