-- CreateTable
CREATE TABLE "labor_driver_crew_members" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tenant_user_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "cid_number" TEXT,
    "cid_issued_on" DATE,
    "phone" TEXT,
    "cid_key" TEXT,
    "email_key" TEXT,
    "every_job" BOOLEAN NOT NULL DEFAULT false,
    "removed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labor_driver_crew_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_labor_members" (
    "tenant_id" TEXT NOT NULL,
    "activity_id" INTEGER NOT NULL,
    "order_num" INTEGER NOT NULL,
    "member_id" TEXT NOT NULL,
    "assigned_by_user_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_labor_members_pkey" PRIMARY KEY ("tenant_id","activity_id","member_id")
);

-- CreateIndex
CREATE INDEX "labor_driver_crew_members_tenant_id_tenant_user_id_idx" ON "labor_driver_crew_members"("tenant_id", "tenant_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "labor_driver_crew_members_tenant_user_id_cid_key_key" ON "labor_driver_crew_members"("tenant_user_id", "cid_key");

-- CreateIndex
CREATE UNIQUE INDEX "labor_driver_crew_members_tenant_user_id_email_key_key" ON "labor_driver_crew_members"("tenant_user_id", "email_key");

-- CreateIndex
CREATE INDEX "activity_labor_members_tenant_id_order_num_idx" ON "activity_labor_members"("tenant_id", "order_num");

-- CreateIndex
CREATE INDEX "activity_labor_members_member_id_idx" ON "activity_labor_members"("member_id");

-- AddForeignKey
ALTER TABLE "labor_driver_crew_members" ADD CONSTRAINT "labor_driver_crew_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_driver_crew_members" ADD CONSTRAINT "labor_driver_crew_members_tenant_user_id_fkey" FOREIGN KEY ("tenant_user_id") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_labor_members" ADD CONSTRAINT "activity_labor_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_labor_members" ADD CONSTRAINT "activity_labor_members_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "labor_driver_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_labor_members" ADD CONSTRAINT "activity_labor_members_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
