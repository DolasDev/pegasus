-- ---------------------------------------------------------------------------
-- RingCentral SMS capture — on-prem target table (SQL Server)
--
-- The on-prem SQL Server is the authoritative store for captured SMS. The cloud
-- forwarder (apps/api/src/lambda-ringcentral-forward.ts) writes here via the
-- mssql-executor over the WireGuard tunnel using an idempotent T-SQL MERGE keyed
-- on (tenant_id, source, external_id).
--
-- Run once per tenant database (the same DB the tenant's mssqlConnectionString
-- points at). Idempotent — safe to re-run. SMS-only: no MMS/attachments column.
-- ---------------------------------------------------------------------------

IF OBJECT_ID(N'dbo.inbound_messages', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.inbound_messages (
    tenant_id      NVARCHAR(64)   NOT NULL,
    source         NVARCHAR(16)   NOT NULL,   -- THREAD_STORE | V1_STORE
    external_id    NVARCHAR(64)   NOT NULL,   -- RingCentral message id
    thread_id      NVARCHAR(64)   NULL,
    direction      NVARCHAR(16)   NOT NULL,   -- INBOUND | OUTBOUND
    from_number    NVARCHAR(32)   NOT NULL,
    to_number      NVARCHAR(32)   NOT NULL,
    body           NVARCHAR(MAX)  NULL,
    rc_created_at  DATETIME2(3)   NOT NULL,
    rc_modified_at DATETIME2(3)   NULL,
    captured_at    DATETIME2(3)   NOT NULL CONSTRAINT DF_inbound_messages_captured DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_inbound_messages PRIMARY KEY (tenant_id, source, external_id)
  );
END
