-- MMS attachment references on captured RingCentral messages (no bytes stored).
CREATE TABLE "public"."message_attachments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "attachment_id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "rc_uri" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_attachments_message_id_attachment_id_key" ON "public"."message_attachments"("message_id", "attachment_id");
CREATE INDEX "message_attachments_tenant_id_idx" ON "public"."message_attachments"("tenant_id");

ALTER TABLE "public"."message_attachments" ADD CONSTRAINT "message_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
