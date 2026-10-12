-- Phase 3b.1 follow-on — automated key rotation. A rotation now parks its new
-- key in a PENDING slot until the key is proven authorized on the namespace,
-- so an unverified key is never served. Purely additive: two nullable columns.

-- AlterTable
ALTER TABLE "tenant_temporal_namespaces" ADD COLUMN     "pending_api_key_ciphertext" TEXT,
ADD COLUMN     "pending_api_key_id" TEXT;
