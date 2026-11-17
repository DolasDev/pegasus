-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "recipient_user_id" TEXT NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "actor_user_id" TEXT,
    "entity_type" VARCHAR(32),
    "entity_id" VARCHAR(64),
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "group_key" VARCHAR(120),
    "dedupe_key" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seen_at" TIMESTAMPTZ(6),
    "read_at" TIMESTAMPTZ(6),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "channel" VARCHAR(8) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_tenant_id_recipient_user_id_created_at_idx" ON "notifications"("tenant_id", "recipient_user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_recipient_user_id_seen_at_idx" ON "notifications"("tenant_id", "recipient_user_id", "seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenant_id_dedupe_key_key" ON "notifications"("tenant_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_tenant_id_user_id_type_key" ON "notification_preferences"("tenant_id", "user_id", "type");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
