-- Migration: Add tenant admin/lifecycle fields and platform schema
-- Adds: TenantStatus enum, TenantPlan enum, admin columns on tenants table,
--       platform schema, admin_users, audit_logs, feature_flags tables.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "platform";

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "public"."TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'OFFBOARDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "public"."TenantPlan" AS ENUM ('STARTER', 'GROWTH', 'ENTERPRISE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: tenants — add admin-managed columns
ALTER TABLE "public"."tenants"
  ADD COLUMN IF NOT EXISTS "status" "public"."TenantStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "plan" "public"."TenantPlan" NOT NULL DEFAULT 'STARTER',
  ADD COLUMN IF NOT EXISTS "contact_name" TEXT,
  ADD COLUMN IF NOT EXISTS "contact_email" TEXT,
  ADD COLUMN IF NOT EXISTS "sso_provider_config" JSONB,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tenants_status_idx" ON "public"."tenants"("status");
CREATE INDEX IF NOT EXISTS "tenants_deleted_at_idx" ON "public"."tenants"("deleted_at");

-- CreateTable: platform.admin_users
CREATE TABLE IF NOT EXISTS "platform"."admin_users" (
    "id" TEXT NOT NULL,
    "cognito_sub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "admin_users_cognito_sub_key" ON "platform"."admin_users"("cognito_sub");
CREATE UNIQUE INDEX IF NOT EXISTS "admin_users_email_key" ON "platform"."admin_users"("email");

-- CreateTable: platform.audit_logs
CREATE TABLE IF NOT EXISTS "platform"."audit_logs" (
    "id" TEXT NOT NULL,
    "admin_sub" TEXT NOT NULL,
    "admin_email" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_logs_resource_id_idx" ON "platform"."audit_logs"("resource_id");
CREATE INDEX IF NOT EXISTS "audit_logs_admin_sub_idx" ON "platform"."audit_logs"("admin_sub");
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "platform"."audit_logs"("created_at");

-- CreateTable: platform.feature_flags
CREATE TABLE IF NOT EXISTS "platform"."feature_flags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_name_key" ON "platform"."feature_flags"("name");
