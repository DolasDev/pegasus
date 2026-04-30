-- Replace legacy_user_id (INTEGER, code from v_longhaul_salesman.code) with
-- legacy_windows_username (TEXT, v_longhaul_salesman.win_username). The
-- on-prem longhaul middleware authenticates via X-Windows-User, so the cloud
-- → on-prem proxy needs the username string rather than the numeric code.
--
-- Safe to drop the old column outright: legacy_user_id was added in
-- 20260430021900 (same day, no production data) and will be re-populated via
-- the Users settings UI as the new column.

DROP INDEX "public"."tenant_users_legacy_user_id_idx";

ALTER TABLE "public"."tenant_users" DROP COLUMN "legacy_user_id";

ALTER TABLE "public"."tenant_users" ADD COLUMN "legacy_windows_username" TEXT;

CREATE INDEX "tenant_users_legacy_windows_username_idx" ON "public"."tenant_users"("legacy_windows_username");
