-- CreateEnum
CREATE TYPE "CompanyMembershipStatus" AS ENUM ('LINKED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CompanyMembershipMatch" AS ENUM ('EMAIL', 'WIN_USERNAME');

-- CreateTable
CREATE TABLE "company_memberships" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "tenant_user_id" TEXT NOT NULL,
    "employee_code" INTEGER NOT NULL,
    "legacy_windows_username" TEXT,
    "status" "CompanyMembershipStatus" NOT NULL,
    "matched_by" "CompanyMembershipMatch" NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_memberships_tenant_id_idx" ON "company_memberships"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_memberships_company_id_tenant_user_id_key" ON "company_memberships"("company_id", "tenant_user_id");

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_tenant_user_id_fkey" FOREIGN KEY ("tenant_user_id") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written (not expressible in the Prisma schema)
-- ---------------------------------------------------------------------------

-- One LINKED user per employee per company. Partial, because INACTIVE rows are
-- kept forever: when a new user takes over an employee row a former user held,
-- the retained INACTIVE row must not block the new link.
CREATE UNIQUE INDEX "company_memberships_one_linked_user_per_employee"
    ON "company_memberships"("company_id", "employee_code") WHERE "status" = 'LINKED';
