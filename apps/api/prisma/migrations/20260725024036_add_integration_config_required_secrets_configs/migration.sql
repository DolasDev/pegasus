-- AlterTable
ALTER TABLE "integration_configs" ADD COLUMN     "required_configs" JSONB,
ADD COLUMN     "required_secrets" JSONB;
