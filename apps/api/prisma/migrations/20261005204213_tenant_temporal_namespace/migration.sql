-- Phase 3b.1 — one Temporal Cloud namespace per tenant. Purely additive: a new
-- table written only by the temporal-provisioner Lambda. Inert until 3b.2
-- routes Automations to it. See prisma/schema.prisma for field docs.

-- CreateEnum
CREATE TYPE "TenantTemporalNamespaceStatus" AS ENUM ('PROVISIONING', 'READY', 'FAILED', 'DEPROVISIONING');

-- CreateTable
CREATE TABLE "tenant_temporal_namespaces" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "grpc_address" TEXT NOT NULL,
    "cloud_service_account_id" TEXT,
    "api_key_id" TEXT,
    "api_key_ciphertext" TEXT,
    "api_key_expires_at" TIMESTAMP(3),
    "previous_api_key_id" TEXT,
    "previous_key_retire_at" TIMESTAMP(3),
    "status" "TenantTemporalNamespaceStatus" NOT NULL DEFAULT 'PROVISIONING',
    "step" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_temporal_namespaces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_temporal_namespaces_tenant_id_key" ON "tenant_temporal_namespaces"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_temporal_namespaces_namespace_key" ON "tenant_temporal_namespaces"("namespace");

-- AddForeignKey
ALTER TABLE "tenant_temporal_namespaces" ADD CONSTRAINT "tenant_temporal_namespaces_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
