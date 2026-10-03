-- ---------------------------------------------------------------------------
-- RingCentral MMS attachments — on-prem reference table (SQL Server)
--
-- One row per MMS attachment (image/video) on a message in dbo.inbound_messages.
-- REFERENCES ONLY: the file stays in RingCentral. Fetch it on demand from the
-- Pegasus API by (source, external_id, attachment_id):
--   GET /api/v1/integrations/ringcentral/messages/{source}/{external_id}/attachments/{attachment_id}
-- rc_uri is RingCentral's own content URL (opening it needs a RingCentral token).
--
-- Written by the cloud forwarder (apps/api/src/lambda-ringcentral-forward.ts) via
-- an idempotent MERGE keyed on (tenant_id, source, external_id, attachment_id),
-- always after its parent message row. Run once per tenant database, AFTER
-- ringcentral-onprem-inbound-messages.sql (the FK needs that table). Idempotent.
-- ---------------------------------------------------------------------------

IF OBJECT_ID(N'dbo.inbound_message_attachments', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.inbound_message_attachments (
    tenant_id      NVARCHAR(64)   NOT NULL,
    source         NVARCHAR(16)   NOT NULL,   -- V1_STORE (thread store not yet supported)
    external_id    NVARCHAR(64)   NOT NULL,   -- parent message (RingCentral message id)
    attachment_id  NVARCHAR(64)   NOT NULL,   -- RingCentral attachment id
    content_type   NVARCHAR(128)  NOT NULL,   -- e.g. image/jpeg, image/png, video/3gpp
    size_bytes     INT            NULL,
    width          INT            NULL,
    height         INT            NULL,
    rc_uri         NVARCHAR(512)  NOT NULL,
    captured_at    DATETIME2(3)   NOT NULL CONSTRAINT DF_inbound_message_attachments_captured DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_inbound_message_attachments PRIMARY KEY (tenant_id, source, external_id, attachment_id),
    CONSTRAINT FK_inbound_message_attachments_message FOREIGN KEY (tenant_id, source, external_id)
      REFERENCES dbo.inbound_messages (tenant_id, source, external_id)
  );
END
