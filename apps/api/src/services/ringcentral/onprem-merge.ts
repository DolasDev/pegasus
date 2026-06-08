// ---------------------------------------------------------------------------
// On-prem T-SQL builder for forwarding captured SMS.
//
// Pure (no I/O): produces a parameterized, idempotent `MERGE` into
// dbo.inbound_messages plus the bound params for the mssql-executor
// (request.input(name, value) → @name). The on-prem SQL Server is the
// authoritative store; the MERGE is keyed on (tenant_id, source, external_id)
// so the forwarder's at-least-once delivery is effectively-once.
// ---------------------------------------------------------------------------

import type { SqlParam } from '../../lib/mssql-executor-client'

/** The fields the forwarder hands to the builder (nullable mirror the row). */
export interface OnPremMessageInput {
  tenantId: string
  source: string
  externalId: string
  threadId?: string | null
  direction: string
  fromNumber: string
  toNumber: string
  body?: string | null
  rcCreationTime: Date
  rcLastModifiedTime?: Date | null
}

export interface BuiltMerge {
  sql: string
  params: SqlParam[]
}

/**
 * One-time DDL for the on-prem target table. Delivered to the on-prem DBA as a
 * migration script (docs/ringcentral-onprem-inbound-messages.sql); kept here so
 * the forwarder could also auto-ensure it on first write if desired. SMS-only —
 * no MMS/attachments column.
 */
export const INBOUND_MESSAGES_DDL = `IF OBJECT_ID(N'dbo.inbound_messages', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.inbound_messages (
    tenant_id      NVARCHAR(64)   NOT NULL,
    source         NVARCHAR(16)   NOT NULL,
    external_id    NVARCHAR(64)   NOT NULL,
    thread_id      NVARCHAR(64)   NULL,
    direction      NVARCHAR(16)   NOT NULL,
    from_number    NVARCHAR(32)   NOT NULL,
    to_number      NVARCHAR(32)   NOT NULL,
    body           NVARCHAR(MAX)  NULL,
    rc_created_at  DATETIME2(3)   NOT NULL,
    rc_modified_at DATETIME2(3)   NULL,
    captured_at    DATETIME2(3)   NOT NULL CONSTRAINT DF_inbound_messages_captured DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_inbound_messages PRIMARY KEY (tenant_id, source, external_id)
  );
END`

/**
 * The idempotent MERGE statement. Parameter names match the @-placeholders.
 * Trailing semicolon is required for T-SQL MERGE.
 */
const MERGE_SQL = `MERGE dbo.inbound_messages AS tgt
USING (SELECT @tenant_id AS tenant_id, @source AS source, @external_id AS external_id) AS src
  ON (tgt.tenant_id = src.tenant_id AND tgt.source = src.source AND tgt.external_id = src.external_id)
WHEN MATCHED THEN UPDATE SET
  direction = @direction, from_number = @from_number, to_number = @to_number,
  body = @body, thread_id = @thread_id, rc_modified_at = @rc_modified_at
WHEN NOT MATCHED THEN INSERT
  (tenant_id, source, external_id, thread_id, direction, from_number, to_number, body, rc_created_at, rc_modified_at)
  VALUES (@tenant_id, @source, @external_id, @thread_id, @direction, @from_number, @to_number, @body, @rc_created_at, @rc_modified_at);`

/** Builds the parameterized on-prem MERGE for a captured message. */
export function buildInboundMessageMerge(input: OnPremMessageInput): BuiltMerge {
  const params: SqlParam[] = [
    { name: 'tenant_id', value: input.tenantId },
    { name: 'source', value: input.source },
    { name: 'external_id', value: input.externalId },
    { name: 'thread_id', value: input.threadId ?? null },
    { name: 'direction', value: input.direction },
    { name: 'from_number', value: input.fromNumber },
    { name: 'to_number', value: input.toNumber },
    { name: 'body', value: input.body ?? null },
    { name: 'rc_created_at', value: input.rcCreationTime },
    { name: 'rc_modified_at', value: input.rcLastModifiedTime ?? null },
  ]
  return { sql: MERGE_SQL, params }
}
