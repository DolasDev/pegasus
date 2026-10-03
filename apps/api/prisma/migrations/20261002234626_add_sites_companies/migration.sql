-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "data_source_key" TEXT,
    "system_employee_code" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sites_tenant_id_idx" ON "sites"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sites_tenant_id_name_key" ON "sites"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "companies_tenant_id_idx" ON "companies"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenant_id_code_key" ON "companies"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "companies_site_id_data_source_key_key" ON "companies"("site_id", "data_source_key");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written (not expressible in the Prisma schema)
-- ---------------------------------------------------------------------------

-- Exactly one default company per tenant: bridge calls without an explicit
-- company target it.
CREATE UNIQUE INDEX "companies_one_default_per_tenant"
    ON "companies"("tenant_id") WHERE "is_default";

-- (site_id, data_source_key) is unique, but Postgres treats NULLs as distinct, so
-- the "site's default database" (data_source_key IS NULL ⇒ no `cid` claim) needs
-- its own guard: at most one company per site may map to it.
CREATE UNIQUE INDEX "companies_one_default_db_per_site"
    ON "companies"("site_id") WHERE "data_source_key" IS NULL;

-- Backfill, idempotent: every tenant already wired to a pegII site (an explicit
-- base URL or a VPN peer) gets one "Primary" site and one default company on the
-- site's default database. No behaviour change — today's single-database tenants
-- mint tokens without `cid`, exactly what their site already serves.
INSERT INTO "sites" ("id", "tenant_id", "name", "created_at", "updated_at")
SELECT gen_random_uuid()::text, t."id", 'Primary', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "tenants" t
 WHERE (t."pegii_api_base_url" IS NOT NULL OR EXISTS (SELECT 1 FROM "VpnPeer" v WHERE v."tenantId" = t."id"))
   AND NOT EXISTS (SELECT 1 FROM "sites" s WHERE s."tenant_id" = t."id");

INSERT INTO "companies" ("id", "tenant_id", "site_id", "code", "display_name", "data_source_key",
                         "system_employee_code", "is_default", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid()::text, s."tenant_id", s."id", UPPER(t."slug"), t."name", NULL,
       NULL, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "sites" s
  JOIN "tenants" t ON t."id" = s."tenant_id"
 WHERE s."name" = 'Primary'
   AND NOT EXISTS (SELECT 1 FROM "companies" c WHERE c."tenant_id" = s."tenant_id");
