-- CreateEnum
CREATE TYPE "public"."TenantUserRole" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "public"."TenantUserStatus" AS ENUM ('PENDING', 'ACTIVE', 'DEACTIVATED');

-- AlterTable
ALTER TABLE "public"."tenants" ADD COLUMN "cognito_auth_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "public"."tenant_users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "cognito_sub" TEXT,
    "role" "public"."TenantUserRole" NOT NULL DEFAULT 'USER',
    "status" "public"."TenantUserStatus" NOT NULL DEFAULT 'PENDING',
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMP(3),
    "deactivated_at" TIMESTAMP(3),

    CONSTRAINT "tenant_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_users_tenant_id_idx" ON "public"."tenant_users"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_users_cognito_sub_idx" ON "public"."tenant_users"("cognito_sub");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_users_tenant_id_email_key" ON "public"."tenant_users"("tenant_id", "email");

-- AddForeignKey
ALTER TABLE "public"."tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
