-- CreateTable
CREATE TABLE "tenant_automation_plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL,
    "monthly_price_cents" INTEGER NOT NULL,
    "annual_pool_actions" INTEGER NOT NULL,
    "overage_cents_per_action" INTEGER NOT NULL,
    "term_start" DATE NOT NULL,
    "term_end" DATE NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "tenant_automation_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_statements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period_month" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL,
    "term_start" DATE NOT NULL,
    "term_end" DATE NOT NULL,
    "monthly_price_cents" INTEGER NOT NULL,
    "pro_rated_plan_cents" INTEGER NOT NULL,
    "actions_in_month" INTEGER NOT NULL,
    "term_to_date_actions" INTEGER NOT NULL,
    "pool" INTEGER NOT NULL,
    "overage_actions" INTEGER NOT NULL,
    "overage_cents_per_action" INTEGER NOT NULL,
    "overage_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_statements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_automation_plans_tenant_id_term_start_effective_from_idx" ON "tenant_automation_plans"("tenant_id", "term_start", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "usage_statements_period" ON "usage_statements"("tenant_id", "period_month");

-- AddForeignKey
ALTER TABLE "tenant_automation_plans" ADD CONSTRAINT "tenant_automation_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_statements" ADD CONSTRAINT "usage_statements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
