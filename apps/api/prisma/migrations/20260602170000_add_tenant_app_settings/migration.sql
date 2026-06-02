-- ---------------------------------------------------------------------------
-- Migration: add tenants.app_settings
--
-- Tenant-wide UI preferences edited via /settings/app. One nested object per
-- main-menu section (dashboard, moves, quotes, customers, dispatch, billing,
-- operations). The shape is enforced in application code by AppSettingsSchema
-- (apps/api/src/lib/app-settings.ts), which parses-with-defaults on every read
-- so adding new optional fields does NOT require a follow-up migration.
--
-- Default '{}' so existing tenants and rows created before this column existed
-- still satisfy the NOT NULL constraint. IF NOT EXISTS keeps the statement
-- idempotent against the dev DB.
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."tenants"
ADD COLUMN IF NOT EXISTS "app_settings" JSONB NOT NULL DEFAULT '{}'::jsonb;
