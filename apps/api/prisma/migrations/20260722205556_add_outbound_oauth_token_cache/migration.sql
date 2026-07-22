-- CreateTable
CREATE TABLE "outbound_oauth_tokens" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "token_url" TEXT NOT NULL,
    "token_ciphertext" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_oauth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbound_oauth_tokens_expires_at_idx" ON "outbound_oauth_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_oauth_tokens_tenant_id_integration_id_token_url_key" ON "outbound_oauth_tokens"("tenant_id", "integration_id", "token_url");

-- AddForeignKey
ALTER TABLE "outbound_oauth_tokens" ADD CONSTRAINT "outbound_oauth_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
