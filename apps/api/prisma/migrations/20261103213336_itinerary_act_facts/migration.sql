-- CreateTable
CREATE TABLE "itinerary_act_facts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "item_key" VARCHAR(120) NOT NULL,
    "source_kind" VARCHAR(32) NOT NULL,
    "order_num" INTEGER NOT NULL,
    "act_code" VARCHAR(16),
    "basis" VARCHAR(8) NOT NULL,
    "day" DATE,
    "window_start" VARCHAR(5),
    "window_end" VARCHAR(5),
    "asserted_by_id" TEXT,
    "captured_by" VARCHAR(32) NOT NULL,
    "asserted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "itinerary_act_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "itinerary_act_facts_tenant_id_item_key_basis_asserted_at_idx" ON "itinerary_act_facts"("tenant_id", "item_key", "basis", "asserted_at");

-- AddForeignKey
ALTER TABLE "itinerary_act_facts" ADD CONSTRAINT "itinerary_act_facts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_act_facts" ADD CONSTRAINT "itinerary_act_facts_asserted_by_id_fkey" FOREIGN KEY ("asserted_by_id") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
