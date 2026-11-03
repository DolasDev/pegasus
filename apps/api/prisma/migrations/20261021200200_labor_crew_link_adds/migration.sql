-- CreateTable
CREATE TABLE "labor_crew_link_adds" (
    "id" TEXT NOT NULL,
    "tenant_user_id" TEXT NOT NULL,
    "crew_phone" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labor_crew_link_adds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "labor_crew_link_adds_tenant_user_id_created_at_idx" ON "labor_crew_link_adds"("tenant_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "labor_crew_link_adds" ADD CONSTRAINT "labor_crew_link_adds_tenant_user_id_fkey" FOREIGN KEY ("tenant_user_id") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
