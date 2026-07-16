-- AlterTable
ALTER TABLE "integration_configs" ADD COLUMN     "inbound" JSONB;

-- CreateTable
CREATE TABLE "ingress_credentials" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_at" TIMESTAMP(3),

    CONSTRAINT "ingress_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "domain_event_id" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingress_credentials_token_prefix_idx" ON "ingress_credentials"("token_prefix");

-- CreateIndex
CREATE UNIQUE INDEX "ingress_credentials_tenant_id_integration_id_key" ON "ingress_credentials"("tenant_id", "integration_id");

-- CreateIndex
CREATE INDEX "inbound_events_tenant_id_integration_id_received_at_idx" ON "inbound_events"("tenant_id", "integration_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_events_tenant_id_integration_id_external_id_key" ON "inbound_events"("tenant_id", "integration_id", "external_id");
