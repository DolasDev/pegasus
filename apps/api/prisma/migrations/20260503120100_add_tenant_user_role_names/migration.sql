-- Add Cedar role-group memberships to each TenantUser.
-- This is the authoritative source for the custom:roles Cognito claim
-- emitted by the pre-token Lambda. The legacy `role` enum column is kept
-- as a write-through shadow during the transition.

ALTER TABLE "public"."tenant_users"
  ADD COLUMN "role_names" TEXT[] NOT NULL DEFAULT '{}';

-- Backfill from the legacy role enum so existing users remain authorised.
UPDATE "public"."tenant_users"
   SET "role_names" = ARRAY['tenant_admin']
 WHERE "role" = 'ADMIN';

UPDATE "public"."tenant_users"
   SET "role_names" = ARRAY['tenant_user']
 WHERE "role" = 'USER';
