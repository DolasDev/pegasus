-- CreateEnum
CREATE TYPE "SmsOptOutSource" AS ENUM ('KEYWORD', 'PROVIDER', 'MANUAL');

-- CreateEnum
CREATE TYPE "SmsSendStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "sms_opt_outs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "opted_out" BOOLEAN NOT NULL,
    "source" "SmsOptOutSource" NOT NULL,
    "keyword" TEXT,
    "message_id" TEXT,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_opt_outs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_sends" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "to_number" TEXT NOT NULL,
    "body_hash" TEXT NOT NULL,
    "status" "SmsSendStatus" NOT NULL,
    "provider_message_id" TEXT,
    "provider_status" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sms_opt_outs_phone_key" ON "sms_opt_outs"("tenant_id", "phone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "sms_sends_dedup_key" ON "sms_sends"("tenant_id", "dedup_key");

-- AddForeignKey
ALTER TABLE "sms_opt_outs" ADD CONSTRAINT "sms_opt_outs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_sends" ADD CONSTRAINT "sms_sends_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
