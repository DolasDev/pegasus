-- CreateTable
CREATE TABLE "labor_company_crew_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "crew_phone" TEXT NOT NULL,
    "nickname" TEXT,
    "added_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labor_company_crew_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "labor_company_crew_links_crew_phone_idx" ON "labor_company_crew_links"("crew_phone");

-- CreateIndex
CREATE UNIQUE INDEX "labor_company_crew_links_tenant_id_crew_phone_key" ON "labor_company_crew_links"("tenant_id", "crew_phone");

-- AddForeignKey
ALTER TABLE "labor_company_crew_links" ADD CONSTRAINT "labor_company_crew_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_company_crew_links" ADD CONSTRAINT "labor_company_crew_links_crew_phone_fkey" FOREIGN KEY ("crew_phone") REFERENCES "labor_crews"("phone") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_company_crew_links" ADD CONSTRAINT "labor_company_crew_links_added_by_user_id_fkey" FOREIGN KEY ("added_by_user_id") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
