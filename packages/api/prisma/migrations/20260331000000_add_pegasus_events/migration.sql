-- CreateTable
CREATE TABLE "public"."pegasus_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_api_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_datetime" TIMESTAMP(3),
    "event_status" TEXT NOT NULL DEFAULT 'NEW',
    "event_publisher" TEXT,
    "event_data" JSONB,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "pegasus_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pegasus_events_event_api_id_key" ON "public"."pegasus_events"("event_api_id");

-- CreateIndex
CREATE INDEX "pegasus_events_tenant_id_idx" ON "public"."pegasus_events"("tenant_id");

-- CreateIndex
CREATE INDEX "pegasus_events_tenant_id_event_type_idx" ON "public"."pegasus_events"("tenant_id", "event_type");

-- CreateIndex
CREATE INDEX "pegasus_events_tenant_id_event_status_idx" ON "public"."pegasus_events"("tenant_id", "event_status");

-- AddForeignKey
ALTER TABLE "public"."pegasus_events" ADD CONSTRAINT "pegasus_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
