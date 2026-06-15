-- ---------------------------------------------------------------------------
-- Migration: 20260615120000_add_tenant_user_longhaul_driver_id
--
-- Adds tenant_users.longhaul_driver_id (INTEGER, nullable) — the legacy
-- longhaul driver id (v_longhaul_drivers.driver_id) a driver login is mapped
-- to. Set by tenant admins via the user management UI so the mobile "My Trips"
-- experience can scope the longhaul trips list to the logged-in driver.
--
-- Purely additive, nullable, no backfill — safe to run against the previous
-- API version (which does not read this column). An unmapped driver simply
-- sees no trips on mobile.
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."tenant_users"
  ADD COLUMN IF NOT EXISTS "longhaul_driver_id" INTEGER;
