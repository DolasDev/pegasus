-- ---------------------------------------------------------------------------
-- Migration: add tenants.longhaul_client
--
-- Per-tenant longhaul client selector ('nwi' | 'qmm') for the cloud-direct
-- longhaul handlers (/dispatchers, /filter-options, /shipments). Replaces the
-- process.env LONGHAUL_CLIENT lookup, which has no correct value in the
-- multi-tenant cloud API Lambda (NWI and QMM tenants share one Lambda).
--
-- Backfill: every tenant with a longhaul MSSQL connection configured today is
-- an NWI client — NWI is the only longhaul deployment currently cloud-onboarded
-- (QMM tenants are not yet remediated). Any future QMM tenant must have this
-- column set to 'qmm' via the platform admin API before its longhaul endpoints
-- are used, otherwise those handlers return 422 LONGHAUL_CLIENT_NOT_CONFIGURED.
--
-- IF NOT EXISTS keeps this idempotent against the dev DB.
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."tenants" ADD COLUMN IF NOT EXISTS "longhaul_client" TEXT;

UPDATE "public"."tenants"
SET "longhaul_client" = 'nwi'
WHERE "mssql_connection_string" IS NOT NULL
  AND "longhaul_client" IS NULL;
