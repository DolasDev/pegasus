-- CreateTable
CREATE TABLE "ringcentral_access_tokens" (
    "connection_id" TEXT NOT NULL,
    "token_ciphertext" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "api_base" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ringcentral_access_tokens_pkey" PRIMARY KEY ("connection_id")
);

-- AddForeignKey
ALTER TABLE "ringcentral_access_tokens" ADD CONSTRAINT "ringcentral_access_tokens_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "ringcentral_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
