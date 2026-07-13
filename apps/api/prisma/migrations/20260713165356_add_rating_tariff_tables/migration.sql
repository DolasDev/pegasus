-- CreateEnum
CREATE TYPE "TariffVersionStatus" AS ENUM ('STAGED', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "TariffFuelSurchargeSource" AS ENUM ('MANUAL', 'EIA_AUTO');

-- CreateTable
CREATE TABLE "tariff_versions" (
    "id" TEXT NOT NULL,
    "tariff_code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3) NOT NULL,
    "status" "TariffVersionStatus" NOT NULL DEFAULT 'STAGED',
    "source_checksum" TEXT NOT NULL,
    "imported_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tariff_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_400ng_zip3s" (
    "id" TEXT NOT NULL,
    "tariff_version_id" TEXT NOT NULL,
    "zip3" CHAR(3) NOT NULL,
    "service_area" TEXT NOT NULL,

    CONSTRAINT "tariff_400ng_zip3s_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_400ng_service_areas" (
    "id" TEXT NOT NULL,
    "tariff_version_id" TEXT NOT NULL,
    "service_area" TEXT NOT NULL,
    "schedule" INTEGER NOT NULL,
    "service_charge_cents_per_cwt" INTEGER NOT NULL,
    "linehaul_factor_cents_per_cwt" INTEGER NOT NULL,

    CONSTRAINT "tariff_400ng_service_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_400ng_linehaul_rates" (
    "id" TEXT NOT NULL,
    "tariff_version_id" TEXT NOT NULL,
    "miles_lower" INTEGER NOT NULL,
    "miles_upper" INTEGER NOT NULL,
    "weight_lower" INTEGER NOT NULL,
    "weight_upper" INTEGER NOT NULL,
    "rate_cents" INTEGER NOT NULL,

    CONSTRAINT "tariff_400ng_linehaul_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_400ng_shorthaul_rates" (
    "id" TEXT NOT NULL,
    "tariff_version_id" TEXT NOT NULL,
    "cwt_miles_lower" INTEGER NOT NULL,
    "cwt_miles_upper" INTEGER NOT NULL,
    "rate_cents" INTEGER NOT NULL,

    CONSTRAINT "tariff_400ng_shorthaul_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_400ng_full_pack_rates" (
    "id" TEXT NOT NULL,
    "tariff_version_id" TEXT NOT NULL,
    "schedule" INTEGER NOT NULL,
    "weight_lower" INTEGER NOT NULL,
    "weight_upper" INTEGER NOT NULL,
    "rate_cents_per_cwt" INTEGER NOT NULL,

    CONSTRAINT "tariff_400ng_full_pack_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_400ng_full_unpack_rates" (
    "id" TEXT NOT NULL,
    "tariff_version_id" TEXT NOT NULL,
    "schedule" INTEGER NOT NULL,
    "rate_millicents_per_cwt" INTEGER NOT NULL,

    CONSTRAINT "tariff_400ng_full_unpack_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_fuel_surcharges" (
    "id" TEXT NOT NULL,
    "tariff_code" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "percent_bps" INTEGER NOT NULL,
    "diesel_price_cents_per_gallon" INTEGER,
    "source" "TariffFuelSurchargeSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tariff_fuel_surcharges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tariff_versions_tariff_code_status_idx" ON "tariff_versions"("tariff_code", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tariff_versions_tariff_code_source_checksum_key" ON "tariff_versions"("tariff_code", "source_checksum");

-- CreateIndex
CREATE INDEX "tariff_400ng_zip3s_tariff_version_id_idx" ON "tariff_400ng_zip3s"("tariff_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "tariff_400ng_zip3s_tariff_version_id_zip3_key" ON "tariff_400ng_zip3s"("tariff_version_id", "zip3");

-- CreateIndex
CREATE INDEX "tariff_400ng_service_areas_tariff_version_id_idx" ON "tariff_400ng_service_areas"("tariff_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "tariff_400ng_service_areas_tariff_version_id_service_area_key" ON "tariff_400ng_service_areas"("tariff_version_id", "service_area");

-- CreateIndex
CREATE INDEX "tariff_400ng_linehaul_rates_tariff_version_id_idx" ON "tariff_400ng_linehaul_rates"("tariff_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "tariff_400ng_linehaul_rates_tariff_version_id_miles_lower_w_key" ON "tariff_400ng_linehaul_rates"("tariff_version_id", "miles_lower", "weight_lower");

-- CreateIndex
CREATE INDEX "tariff_400ng_shorthaul_rates_tariff_version_id_idx" ON "tariff_400ng_shorthaul_rates"("tariff_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "tariff_400ng_shorthaul_rates_tariff_version_id_cwt_miles_lo_key" ON "tariff_400ng_shorthaul_rates"("tariff_version_id", "cwt_miles_lower");

-- CreateIndex
CREATE INDEX "tariff_400ng_full_pack_rates_tariff_version_id_schedule_idx" ON "tariff_400ng_full_pack_rates"("tariff_version_id", "schedule");

-- CreateIndex
CREATE UNIQUE INDEX "tariff_400ng_full_pack_rates_tariff_version_id_schedule_wei_key" ON "tariff_400ng_full_pack_rates"("tariff_version_id", "schedule", "weight_lower");

-- CreateIndex
CREATE INDEX "tariff_400ng_full_unpack_rates_tariff_version_id_schedule_idx" ON "tariff_400ng_full_unpack_rates"("tariff_version_id", "schedule");

-- CreateIndex
CREATE UNIQUE INDEX "tariff_400ng_full_unpack_rates_tariff_version_id_schedule_key" ON "tariff_400ng_full_unpack_rates"("tariff_version_id", "schedule");

-- CreateIndex
CREATE INDEX "tariff_fuel_surcharges_tariff_code_effective_from_idx" ON "tariff_fuel_surcharges"("tariff_code", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "tariff_fuel_surcharges_tariff_code_effective_from_key" ON "tariff_fuel_surcharges"("tariff_code", "effective_from");

-- AddForeignKey
ALTER TABLE "tariff_400ng_zip3s" ADD CONSTRAINT "tariff_400ng_zip3s_tariff_version_id_fkey" FOREIGN KEY ("tariff_version_id") REFERENCES "tariff_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff_400ng_service_areas" ADD CONSTRAINT "tariff_400ng_service_areas_tariff_version_id_fkey" FOREIGN KEY ("tariff_version_id") REFERENCES "tariff_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff_400ng_linehaul_rates" ADD CONSTRAINT "tariff_400ng_linehaul_rates_tariff_version_id_fkey" FOREIGN KEY ("tariff_version_id") REFERENCES "tariff_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff_400ng_shorthaul_rates" ADD CONSTRAINT "tariff_400ng_shorthaul_rates_tariff_version_id_fkey" FOREIGN KEY ("tariff_version_id") REFERENCES "tariff_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff_400ng_full_pack_rates" ADD CONSTRAINT "tariff_400ng_full_pack_rates_tariff_version_id_fkey" FOREIGN KEY ("tariff_version_id") REFERENCES "tariff_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff_400ng_full_unpack_rates" ADD CONSTRAINT "tariff_400ng_full_unpack_rates_tariff_version_id_fkey" FOREIGN KEY ("tariff_version_id") REFERENCES "tariff_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
