-- AlterTable
ALTER TABLE "public"."tenant_users" ADD COLUMN "legacy_user_id" INTEGER;

-- CreateIndex
CREATE INDEX "tenant_users_legacy_user_id_idx" ON "public"."tenant_users"("legacy_user_id");
