// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct saved-shipment-filter CRUD handlers.
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

import {
  longhaulSaveShipmentFilterHandler,
  longhaulSetDefaultShipmentFilterHandler,
  longhaulDeleteShipmentFilterHandler,
} from './shipment-filters-write'
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
  app.post('/onprem/longhaul/shipment-filters', longhaulSaveShipmentFilterHandler)
  app.put('/onprem/longhaul/shipment-filters/default', longhaulSetDefaultShipmentFilterHandler)
  app.delete('/onprem/longhaul/shipment-filters/:id', longhaulDeleteShipmentFilterHandler)
  return app
}

function req(path: string, method: string, body?: unknown) {
  return buildApp().request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveMock.mockResolvedValue({ ok: true, connectionString: 'Server=a,1433', code: 7, user: {} })
  executeSqlMock.mockResolvedValue({ recordset: [], recordsets: [[]], rowsAffected: [1] })
})

describe('POST /shipment-filters (cloud-direct)', () => {
  it('inserts the filter (body owner_code, trimmed name) and returns it with 201', async () => {
    executeSqlMock.mockResolvedValue({
      recordset: [{ filter_id: 12, name: 'Mine', owner_code: 88, is_public: false }],
      recordsets: [[]],
      rowsAffected: [1],
    })
    const res = await req('/onprem/longhaul/shipment-filters', 'POST', {
      name: '  Mine  ',
      user_code: 88,
      query: { filters: {} },
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      data: { filter_id: 12, name: 'Mine', owner_code: 88, is_public: false },
    })
    const [, sql, opts] = executeSqlMock.mock.calls[0]!
    expect(sql).toContain('INSERT INTO longhaul_shipment_filter')
    expect(sql).toContain('OUTPUT INSERTED.*')
    expect(opts.params).toContainEqual({ name: 'name', value: 'Mine' })
    expect(opts.params).toContainEqual({ name: 'owner_code', value: 88 })
    expect(opts.params).toContainEqual({ name: 'is_public', value: false })
    expect(executeSqlMock).toHaveBeenCalledTimes(1) // no default upsert
  })

  it('transforms date-range fields in the query to day offsets', async () => {
    executeSqlMock.mockResolvedValue({
      recordset: [{ filter_id: 1 }],
      recordsets: [[]],
      rowsAffected: [1],
    })
    const today = new Date(new Date().toDateString())
    const plus3 = new Date(today)
    plus3.setDate(plus3.getDate() + 3)
    const iso = `${plus3.getFullYear()}-${String(plus3.getMonth() + 1).padStart(2, '0')}-${String(plus3.getDate()).padStart(2, '0')}`

    await req('/onprem/longhaul/shipment-filters', 'POST', {
      name: 'f',
      user_code: 1,
      query: { filters: { load_date: [iso, null] } },
    })
    const [, , opts] = executeSqlMock.mock.calls[0]!
    const queryParam = opts.params.find((p: { name: string }) => p.name === 'query')
    const saved = JSON.parse(queryParam.value as string)
    expect(saved.filters.load_date).toEqual([3, null])
  })

  it('upserts the default preference when is_default is set', async () => {
    executeSqlMock
      .mockResolvedValueOnce({
        recordset: [{ filter_id: 99 }],
        recordsets: [[]],
        rowsAffected: [1],
      })
      .mockResolvedValueOnce({ recordset: [], recordsets: [[]], rowsAffected: [1] })
    const res = await req('/onprem/longhaul/shipment-filters', 'POST', {
      name: 'f',
      user_code: 5,
      query: {},
      is_default: true,
    })
    expect(res.status).toBe(201)
    expect(executeSqlMock).toHaveBeenCalledTimes(2)
    const [, defSql, defOpts] = executeSqlMock.mock.calls[1]!
    expect(defSql).toContain('longhaul_user_preferences')
    expect(defOpts.params).toContainEqual({ name: 'user_id', value: 5 })
    expect(defOpts.params).toContainEqual({ name: 'filter_id', value: 99 })
  })

  it('rejects an empty name with 400', async () => {
    const res = await req('/onprem/longhaul/shipment-filters', 'POST', {
      name: '',
      user_code: 1,
      query: {},
    })
    expect(res.status).toBe(400)
    expect(executeSqlMock).not.toHaveBeenCalled()
  })
})

describe('PUT /shipment-filters/default (cloud-direct)', () => {
  it('upserts the user default keyed by the resolved code', async () => {
    const res = await req('/onprem/longhaul/shipment-filters/default', 'PUT', { filter_id: 42 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { success: true } })
    const [, sql, opts] = executeSqlMock.mock.calls[0]!
    expect(sql).toContain('longhaul_user_preferences')
    expect(opts.params).toContainEqual({ name: 'user_id', value: 7 })
    expect(opts.params).toContainEqual({ name: 'filter_id', value: 42 })
  })

  it('returns 403 when no legacy user code is resolved (M2M)', async () => {
    resolveMock.mockResolvedValue({
      ok: true,
      connectionString: 'Server=a,1433',
      code: null,
      user: null,
    })
    const res = await req('/onprem/longhaul/shipment-filters/default', 'PUT', { filter_id: 42 })
    expect(res.status).toBe(403)
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('rejects a missing filter_id with 400', async () => {
    const res = await req('/onprem/longhaul/shipment-filters/default', 'PUT', {})
    expect(res.status).toBe(400)
  })
})

describe('DELETE /shipment-filters/:id (cloud-direct)', () => {
  it('deletes the filter by id', async () => {
    const res = await req('/onprem/longhaul/shipment-filters/15', 'DELETE')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { success: true } })
    const [, sql, opts] = executeSqlMock.mock.calls[0]!
    expect(sql).toContain('DELETE FROM longhaul_shipment_filter WHERE filter_id = @id')
    expect(opts.params).toContainEqual({ name: 'id', value: 15 })
  })

  it('rejects a non-numeric id with 400', async () => {
    const res = await req('/onprem/longhaul/shipment-filters/abc', 'DELETE')
    expect(res.status).toBe(400)
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the delete fails', async () => {
    executeSqlMock.mockRejectedValue(new Error('boom'))
    const res = await req('/onprem/longhaul/shipment-filters/15', 'DELETE')
    expect(res.status).toBe(500)
  })
})
