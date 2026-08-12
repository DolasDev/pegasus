-- CreateEnum
CREATE TYPE "DashboardVisibility" AS ENUM ('GLOBAL', 'TENANT');

-- CreateEnum
CREATE TYPE "DashboardStatus" AS ENUM ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "tenant_users" ADD COLUMN     "preferences" JSONB;

-- CreateTable
CREATE TABLE "dashboard_definitions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "visibility" "DashboardVisibility" NOT NULL DEFAULT 'TENANT',
    "status" "DashboardStatus" NOT NULL DEFAULT 'PUBLISHED',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "definition" JSONB NOT NULL,
    "published_by" TEXT NOT NULL,
    "forked_from_definition_id" TEXT,
    "forked_from_version" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dashboard_definitions_tenant_id_status_idx" ON "dashboard_definitions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "dashboard_definitions_slug_visibility_status_idx" ON "dashboard_definitions"("slug", "visibility", "status");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_definitions_tenant_id_slug_version_key" ON "dashboard_definitions"("tenant_id", "slug", "version");
