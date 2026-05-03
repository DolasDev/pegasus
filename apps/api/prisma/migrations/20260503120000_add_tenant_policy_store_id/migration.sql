-- Add the AVP (AWS Verified Permissions) policy-store ID to each tenant.
-- One Cedar policy store is provisioned per tenant at create time
-- (apps/api/src/lib/authz-provision.ts). Nullable so pre-existing tenants
-- continue to load; a separate ops task backfills them.

ALTER TABLE "public"."tenants" ADD COLUMN "policy_store_id" TEXT;
