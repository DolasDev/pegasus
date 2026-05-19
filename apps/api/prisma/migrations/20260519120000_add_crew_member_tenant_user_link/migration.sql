-- ---------------------------------------------------------------------------
-- Migration: link crew_members to tenant_users
--
-- Adds an optional, unique FK from a crew member to the tenant login that
-- belongs to them. Set when a crew member is granted a `driver` persona login
-- so the Moves list/detail can be scoped to their own trips. Additive and
-- nullable — no backfill. ON DELETE SET NULL: deleting the login unlinks the
-- crew member rather than cascading.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "public"."crew_members" ADD COLUMN "tenant_user_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "crew_members_tenant_user_id_key" ON "public"."crew_members"("tenant_user_id");

-- AddForeignKey
ALTER TABLE "public"."crew_members" ADD CONSTRAINT "crew_members_tenant_user_id_fkey" FOREIGN KEY ("tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
