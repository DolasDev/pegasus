import { describe, it, expect } from 'vitest'
import { buildInboundMessageMerge, INBOUND_MESSAGES_DDL } from '../onprem-merge'

const base = {
  tenantId: 'tnt-1',
  source: 'THREAD_STORE',
  externalId: '9001',
  threadId: 'thread-42',
  direction: 'INBOUND',
  fromNumber: '+19085760908',
  toNumber: '+12015550123',
  body: 'hello',
  rcCreationTime: new Date('2026-06-02T10:00:00.000Z'),
  rcLastModifiedTime: new Date('2026-06-02T10:00:01.000Z'),
}

describe('buildInboundMessageMerge', () => {
  it('produces a single idempotent MERGE keyed on (tenant_id, source, external_id)', () => {
    const { sql } = buildInboundMessageMerge(base)
    expect(sql).toContain('MERGE dbo.inbound_messages AS tgt')
    expect(sql).toContain(
      'tgt.tenant_id = src.tenant_id AND tgt.source = src.source AND tgt.external_id = src.external_id',
    )
    expect(sql).toContain('WHEN MATCHED THEN UPDATE SET')
    expect(sql).toContain('WHEN NOT MATCHED THEN INSERT')
    expect(sql.trim().endsWith(';')).toBe(true) // T-SQL MERGE must be terminated
    // single statement — exactly one terminating semicolon
    expect(sql.match(/;/g)).toHaveLength(1)
  })

  it('binds every @placeholder as a named param with the right value', () => {
    const { sql, params } = buildInboundMessageMerge(base)
    const byName = Object.fromEntries(params.map((p) => [p.name, p.value]))
    expect(byName).toMatchObject({
      tenant_id: 'tnt-1',
      source: 'THREAD_STORE',
      external_id: '9001',
      thread_id: 'thread-42',
      direction: 'INBOUND',
      from_number: '+19085760908',
      to_number: '+12015550123',
      body: 'hello',
    })
    expect(byName['rc_created_at']).toBeInstanceOf(Date)
    expect(byName['rc_modified_at']).toBeInstanceOf(Date)
    // Every @param in the SQL has a matching binding (no unbound placeholders).
    const placeholders = new Set([...sql.matchAll(/@(\w+)/g)].map((m) => m[1]!))
    for (const ph of placeholders) expect(byName).toHaveProperty(ph)
  })

  it('passes null for absent optional fields (body, thread_id, rc_modified_at)', () => {
    const { params } = buildInboundMessageMerge({
      ...base,
      threadId: null,
      body: null,
      rcLastModifiedTime: null,
    })
    const byName = Object.fromEntries(params.map((p) => [p.name, p.value]))
    expect(byName['thread_id']).toBeNull()
    expect(byName['body']).toBeNull()
    expect(byName['rc_modified_at']).toBeNull()
  })

  it('treats undefined optionals as null', () => {
    const { params } = buildInboundMessageMerge({
      tenantId: 't',
      source: 'V1_STORE',
      externalId: '1',
      direction: 'OUTBOUND',
      fromNumber: '+19085760908',
      toNumber: '+12015550123',
      rcCreationTime: new Date('2026-05-31T08:00:00.000Z'),
    })
    const byName = Object.fromEntries(params.map((p) => [p.name, p.value]))
    expect(byName['thread_id']).toBeNull()
    expect(byName['body']).toBeNull()
    expect(byName['rc_modified_at']).toBeNull()
  })
})

describe('INBOUND_MESSAGES_DDL', () => {
  it('creates the table idempotently with the composite PK', () => {
    expect(INBOUND_MESSAGES_DDL).toContain("IF OBJECT_ID(N'dbo.inbound_messages', N'U') IS NULL")
    expect(INBOUND_MESSAGES_DDL).toContain(
      'CONSTRAINT PK_inbound_messages PRIMARY KEY (tenant_id, source, external_id)',
    )
  })
})
