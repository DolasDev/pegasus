-- CreateTable
CREATE TABLE "labor_crew_access_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "crew_phone" TEXT NOT NULL,
    "order_num" INTEGER NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "shared_by_user_id" TEXT NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "burned_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labor_crew_access_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labor_crew_access_otps" (
    "id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labor_crew_access_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labor_crew_access_sessions" (
    "id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labor_crew_access_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labor_crew_access_audit" (
    "id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "packer_id" TEXT,
    "activity_id" INTEGER,
    "detail" JSONB,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labor_crew_access_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "labor_crew_access_links_token_prefix_idx" ON "labor_crew_access_links"("token_prefix");

-- CreateIndex
CREATE INDEX "labor_crew_access_links_tenant_id_order_num_crew_phone_idx" ON "labor_crew_access_links"("tenant_id", "order_num", "crew_phone");

-- CreateIndex
CREATE INDEX "labor_crew_access_otps_link_id_created_at_idx" ON "labor_crew_access_otps"("link_id", "created_at");

-- CreateIndex
CREATE INDEX "labor_crew_access_sessions_token_prefix_idx" ON "labor_crew_access_sessions"("token_prefix");

-- CreateIndex
CREATE INDEX "labor_crew_access_sessions_link_id_idx" ON "labor_crew_access_sessions"("link_id");

-- CreateIndex
CREATE INDEX "labor_crew_access_audit_link_id_at_idx" ON "labor_crew_access_audit"("link_id", "at");

-- AddForeignKey
ALTER TABLE "labor_crew_access_links" ADD CONSTRAINT "labor_crew_access_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_crew_access_links" ADD CONSTRAINT "labor_crew_access_links_crew_phone_fkey" FOREIGN KEY ("crew_phone") REFERENCES "labor_crews"("phone") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_crew_access_links" ADD CONSTRAINT "labor_crew_access_links_shared_by_user_id_fkey" FOREIGN KEY ("shared_by_user_id") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_crew_access_otps" ADD CONSTRAINT "labor_crew_access_otps_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "labor_crew_access_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_crew_access_sessions" ADD CONSTRAINT "labor_crew_access_sessions_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "labor_crew_access_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_crew_access_audit" ADD CONSTRAINT "labor_crew_access_audit_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "labor_crew_access_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
