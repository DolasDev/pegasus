-- Drop the legacy single-role column and the TenantUserRole enum.
-- The Cedar role-group memberships in `role_names` are now the sole source
-- of truth for tenant-user authorisation. See
-- plans/in-progress/authz-cedar-avp-followups.md item #6.

ALTER TABLE "public"."tenant_users" DROP COLUMN "role";

DROP TYPE "public"."TenantUserRole";
