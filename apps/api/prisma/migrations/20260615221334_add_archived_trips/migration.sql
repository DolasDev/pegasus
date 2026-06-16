-- CreateTable
CREATE TABLE "archived_trips" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'rejected',
    "original_trip_id" INTEGER NOT NULL,
    "trip_title" TEXT,
    "original_driver_id" INTEGER,
    "original_driver_name" TEXT,
    "planned_first_day" TIMESTAMP(3),
    "planned_last_day" TIMESTAMP(3),
    "origin_state_code" TEXT,
    "dest_state_code" TEXT,
    "total_estimated_lbs" INTEGER,
    "total_estimated_linehaul_usd" DECIMAL(65,30),
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,

    CONSTRAINT "archived_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archived_trip_drivers" (
    "id" TEXT NOT NULL,
    "archived_trip_id" TEXT NOT NULL,
    "driver_id" INTEGER NOT NULL,
    "driver_name" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archived_trip_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "archived_trips_tenant_id_kind_idx" ON "archived_trips"("tenant_id", "kind");

-- CreateIndex
CREATE INDEX "archived_trips_tenant_id_original_trip_id_idx" ON "archived_trips"("tenant_id", "original_trip_id");

-- CreateIndex
CREATE INDEX "archived_trip_drivers_driver_id_idx" ON "archived_trip_drivers"("driver_id");

-- CreateIndex
CREATE INDEX "archived_trip_drivers_archived_trip_id_idx" ON "archived_trip_drivers"("archived_trip_id");

-- AddForeignKey
ALTER TABLE "archived_trips" ADD CONSTRAINT "archived_trips_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archived_trip_drivers" ADD CONSTRAINT "archived_trip_drivers_archived_trip_id_fkey" FOREIGN KEY ("archived_trip_id") REFERENCES "archived_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
