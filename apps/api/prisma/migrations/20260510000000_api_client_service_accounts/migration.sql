-- API clients act as service-account TenantUsers (Cedar-gated).
--
-- Adds:
--   1. tenant_users.is_service_account — distinguishes non-human principals
--      that exist solely to be acted-as by an ApiClient.
--   2. api_clients.acts_as_user_id — FK to the service-account TenantUser
--      whose roleNames Cedar/AVP authorises against. Nullable at the column
--      level so the migration is non-destructive; the API enforces non-null
--      on create/update and validates the target is a service account in the
--      same tenant.
--
-- No data backfill: existing api_clients rows leave acts_as_user_id NULL and
-- are stale post-migration. Operator deletes and recreates them via the
-- updated UI (see plans/in-progress/2026-05-10T0000-api-client-service-accounts.md).

-- AlterTable
ALTER TABLE "public"."tenant_users" ADD COLUMN "is_service_account" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."api_clients" ADD COLUMN "acts_as_user_id" TEXT;

-- CreateIndex
CREATE INDEX "api_clients_acts_as_user_id_idx" ON "public"."api_clients"("acts_as_user_id");

-- AddForeignKey
ALTER TABLE "public"."api_clients" ADD CONSTRAINT "api_clients_acts_as_user_id_fkey" FOREIGN KEY ("acts_as_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
