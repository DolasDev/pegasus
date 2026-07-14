-- AlterTable
ALTER TABLE "integration_configs" ADD COLUMN     "forked_from_config_id" TEXT,
ADD COLUMN     "forked_from_version" INTEGER;
