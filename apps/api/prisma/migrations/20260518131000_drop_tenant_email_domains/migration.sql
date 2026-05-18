-- ---------------------------------------------------------------------------
-- Migration: drop tenants.email_domains
--
-- Login tenant resolution is now purely roster-based: the pre-token Lambda and
-- resolve-tenants both key off tenant_users membership for the authenticated
-- user. The email_domains array (added in 0003_tenant_email_domains) was a
-- resolution heuristic the roster already supersedes — it has no remaining
-- consumer, so the column and its GIN index are removed.
--
-- IF EXISTS keeps this idempotent against the dev DB.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS "public"."tenants_email_domains_gin";

ALTER TABLE "public"."tenants" DROP COLUMN IF EXISTS "email_domains";
