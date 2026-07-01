-- AlterTable
ALTER TABLE "public"."tenants" ADD COLUMN "customer_source" TEXT;
ALTER TABLE "public"."tenants" ADD COLUMN "pegii_api_base_url" TEXT;
ALTER TABLE "public"."tenants" ADD COLUMN "pegii_api_key_ref" TEXT;
