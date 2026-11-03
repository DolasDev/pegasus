-- CreateTable
CREATE TABLE "activity_labor_crews" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "activity_id" INTEGER NOT NULL,
    "order_num" INTEGER NOT NULL,
    "crew_phone" TEXT NOT NULL,
    "assigned_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_labor_crews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_labor_packers" (
    "activity_labor_crew_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "packer_id" TEXT NOT NULL,

    CONSTRAINT "activity_labor_packers_pkey" PRIMARY KEY ("activity_labor_crew_id","packer_id")
);

-- CreateIndex
CREATE INDEX "activity_labor_crews_tenant_id_order_num_idx" ON "activity_labor_crews"("tenant_id", "order_num");

-- CreateIndex
CREATE UNIQUE INDEX "activity_labor_crews_tenant_id_activity_id_crew_phone_key" ON "activity_labor_crews"("tenant_id", "activity_id", "crew_phone");

-- CreateIndex
CREATE INDEX "activity_labor_packers_packer_id_idx" ON "activity_labor_packers"("packer_id");

-- AddForeignKey
ALTER TABLE "activity_labor_crews" ADD CONSTRAINT "activity_labor_crews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_labor_crews" ADD CONSTRAINT "activity_labor_crews_crew_phone_fkey" FOREIGN KEY ("crew_phone") REFERENCES "labor_crews"("phone") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_labor_crews" ADD CONSTRAINT "activity_labor_crews_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_labor_packers" ADD CONSTRAINT "activity_labor_packers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_labor_packers" ADD CONSTRAINT "activity_labor_packers_activity_labor_crew_id_fkey" FOREIGN KEY ("activity_labor_crew_id") REFERENCES "activity_labor_crews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_labor_packers" ADD CONSTRAINT "activity_labor_packers_packer_id_fkey" FOREIGN KEY ("packer_id") REFERENCES "labor_packers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
