-- ---------------------------------------------------------------------------
-- Migration: drop the redundant customers_email_idx
--
-- 0001_init created two indexes on customers.email:
--   * customers_email_key  (UNIQUE)  — dropped in 20260406... when the
--                                       composite @@unique([tenantId, email])
--                                       was introduced.
--   * customers_email_idx  (non-unique) — orphaned. Functionally subsumed by
--                                          customers_tenant_id_email_key, which
--                                          serves email-prefix lookups via the
--                                          tenant_id prefix.
--
-- The current schema.prisma declares no @@index([email]) on Customer, so the
-- live dev DB (where the index was manually dropped) is the intended state.
-- This migration brings fresh spin-ups in line: IF EXISTS so applying against
-- the dev DB is a no-op + so partial migration runs don't error.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS "customers_email_idx";
