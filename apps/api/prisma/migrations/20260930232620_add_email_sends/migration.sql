-- CreateEnum
CREATE TYPE "EmailSendStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "email_sends" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dedup_key" TEXT,
    "to_addresses" TEXT[],
    "cc_addresses" TEXT[],
    "subject" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "EmailSendStatus" NOT NULL,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_sends_tenant_id_created_at_idx" ON "email_sends"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_sends_dedup_key" ON "email_sends"("tenant_id", "dedup_key");

-- AddForeignKey
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
