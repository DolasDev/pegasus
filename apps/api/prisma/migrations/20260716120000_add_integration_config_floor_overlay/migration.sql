-- AlterTable: floor/overlay split (sdk-feedback 0019 + 0020). All nullable so
-- existing rows fall back to the built-in overlay / identity external shape.
ALTER TABLE "integration_configs" ADD COLUMN     "floor" TEXT,
ADD COLUMN     "display_name" TEXT,
ADD COLUMN     "external_shape" JSONB,
ADD COLUMN     "external_mapping" JSONB;
