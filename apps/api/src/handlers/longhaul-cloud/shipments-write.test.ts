// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct shipment write handlers (weight/shadow/coverage).
// resolveLonghaulUser and executeSql are mocked.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import { registerTestErrorHandler } from '../../test-helpers'
import type * as MssqlClient from '../../lib/mssql-executor-client'

vi.mock('../../lib/longhaul-cloud-user', () => ({ resolveLonghaulUser: vi.fn() }))
vi.mock('../../lib/mssql-executor-client', async (orig) => ({
  ...(await orig<typeof MssqlClient>()),
  executeSql: vi.fn(),
}))

import { longhaulShipmentShadowHandler, longhaulShipmentCoverageHandler } from './shipments-write'
import { resolveLonghaulUser } from '../../lib/longhaul-cloud-user'
import { executeSql } from '../../lib/mssql-executor-client'

const resolveMock = resolveLonghaulUser as unknown as Mock
const executeSqlMock = executeSql as unknown as Mock

function buildApp() {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    c.set('userId', 'user-1')
    await next()
  })
  app.patch('/onprem/longhaul/shipments/:id/shadow', longhaulShipmentShadowHandler)
  app.post('/onprem/longhaul/shipments/:id/coverage', longhaulShipmentCoverageHandler)
  return app
}

function req(path: string, method: string, body: unknown) {
  return buildApp().request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveMock.mockResolvedValue({ ok: true, connectionString: 'Server=a,1433', code: 7, user: {} })
  executeSqlMock.mockResolvedValue({ recordset: [], recordsets: [[]], rowsAffected: [1] })
})

describe('PATCH /shipments/:id/shadow (cloud-direct)', () => {
  it('updates only the provided shadow columns (preserves omitted)', async () => {
    const res = await req('/onprem/longhaul/shipments/100/shadow', 'PATCH', {
      order_num: 100,
      lng_dis_comments: 'note-x',
    })
    expect(res.status).toBe(200)
    const [, sql, opts] = executeSqlMock.mock.calls[0]!
    expect(sql).toContain('lng_dis_comments = @lng_dis_comments')
    expect(sql).not.toContain('operations_id')
    expect(sql).not.toContain('weight = @weight')
    expect(opts.params).toContainEqual({ name: 'lng_dis_comments', value: 'note-x' })
    expect(opts.params).toContainEqual({ name: 'order_num', value: 100 })
  })

  it('ensures the row exists when no shadow fields are provided', async () => {
    await req('/onprem/longhaul/shipments/100/shadow', 'PATCH', { order_num: 100 })
    const [, sql] = executeSqlMock.mock.calls[0]!
    expect(sql).toContain('IF NOT EXISTS')
    expect(sql).toContain('INSERT INTO sales (order_num)')
  })

  it('returns 400 when order_num is missing from the body', async () => {
    const res = await req('/onprem/longhaul/shipments/100/shadow', 'PATCH', {
      lng_dis_comments: 'x',
    })
    expect(res.status).toBe(400)
    expect(executeSqlMock).not.toHaveBeenCalled()
  })
})

describe('POST /shipments/:id/coverage (cloud-direct)', () => {
  it('upserts coverage atomically and returns the saved row with 201', async () => {
    executeSqlMock.mockResolvedValue({
      recordset: [{ id: 9, order_num: 100, activity_code: 'PACK', coverage_agent_id: 'A1' }],
      recordsets: [[{ id: 9 }]],
      rowsAffected: [1, 1],
    })
    const res = await req('/onprem/longhaul/shipments/100/coverage', 'POST', {
      order_num: 100,
      activity_code: 'PACK',
      coverage_agent_id: 'A1',
      is_covered: true,
      note: 'covered',
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      data: { id: 9, order_num: 100, activity_code: 'PACK', coverage_agent_id: 'A1' },
    })
    const [, sql, opts] = executeSqlMock.mock.calls[0]!
    expect(sql).toContain('BEGIN TRAN')
    expect(sql).toContain('COMMIT TRAN')
    expect(sql).toContain('ROLLBACK TRAN')
    // trailing SELECT after COMMIT returns the saved row (Unit 0 pattern)
    expect(sql.trim().split('COMMIT TRAN;')[1]).toContain('SELECT * FROM longhaul_shipmentcoverage')
    expect(opts.params).toContainEqual({ name: 'order_num', value: 100 })
    expect(opts.params).toContainEqual({ name: 'is_covered', value: true })
    expect(opts.params).toContainEqual({ name: 'note', value: 'covered' })
  })

  it('returns 400 when a key field is missing', async () => {
    const res = await req('/onprem/longhaul/shipments/100/coverage', 'POST', {
      order_num: 100,
      activity_code: 'PACK',
    })
    expect(res.status).toBe(400)
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the executor write fails', async () => {
    executeSqlMock.mockRejectedValue(new Error('boom'))
    const res = await req('/onprem/longhaul/shipments/100/coverage', 'POST', {
      order_num: 100,
      activity_code: 'PACK',
      coverage_agent_id: 'A1',
    })
    expect(res.status).toBe(500)
  })
})
