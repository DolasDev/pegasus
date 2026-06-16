// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct longhaul /shipment-filters handler.
//
// Prisma and the mssql-executor client are mocked so the test never touches
// Postgres or the executor Lambda.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import { registerTestErrorHandler } from '../../test-helpers'

vi.mock('../../db', () => ({
  db: {
    tenant: { findUnique: vi.fn() },
    tenantUser: { findUnique: vi.fn() },
  },
}))
vi.mock('../../lib/mssql-executor-client', () => ({
  executeSql: vi.fn(),
}))

import { longhaulShipmentFiltersHandler } from './shipment-filters'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'

const tenantFind = db.tenant.findUnique as unknown as Mock
const tenantUserFind = db.tenantUser.findUnique as unknown as Mock
const executeSqlMock = executeSql as unknown as Mock

const ACTIVE_SALESMAN = { code: 42, first_name: 'Ada', last_name: 'Lovelace', active: 'Y' }

function buildApp(opts: { userId?: string | undefined } = { userId: 'user-1' }) {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    if (opts.userId) c.set('userId', opts.userId)
    await next()
  })
  app.get('/onprem/longhaul/shipment-filters', longhaulShipmentFiltersHandler)
  return app
}

describe('GET longhaul/shipment-filters (cloud-direct)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the saved filters in { data: [...] } shape, folding the joined owner name (self scope)', async () => {
    tenantFind.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFind.mockResolvedValue({ legacyWindowsUsername: 'DOMAIN\\ada' })
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [ACTIVE_SALESMAN], rowsAffected: [] })
      .mockResolvedValueOnce({
        recordset: [
          {
            filter_id: 1,
            name: 'Mine',
            owner_code: 42,
            query: 'not-json',
            owner_first_name: 'Ada',
            owner_last_name: 'Lovelace',
          },
        ],
        rowsAffected: [],
      })

    const res = await buildApp().request('/onprem/longhaul/shipment-filters')

    expect(res.status).toBe(200)
    // the flat owner_first_name/owner_last_name columns are folded into a nested
    // `owner` object — what the FilterModal "Created By" column renders
    expect(await res.json()).toEqual({
      data: [
        {
          filter_id: 1,
          name: 'Mine',
          owner_code: 42,
          query: 'not-json',
          owner: { code: 42, first_name: 'Ada', last_name: 'Lovelace' },
        },
      ],
    })
    // one executor call to resolve the user, one to fetch the filters
    expect(executeSqlMock).toHaveBeenCalledTimes(2)
    // the filters query joins v_longhaul_salesman to resolve the owner name
    expect(executeSqlMock.mock.calls[1]?.[1]).toContain('LEFT JOIN v_longhaul_salesman')
    expect(executeSqlMock.mock.calls[1]?.[2]).toEqual({
      params: [{ name: 'ownerCode', value: 42 }],
    })
  })

  it('returns owner: null when the joined salesman row is absent (LEFT JOIN miss)', async () => {
    tenantFind.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFind.mockResolvedValue({ legacyWindowsUsername: 'DOMAIN\\ada' })
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [ACTIVE_SALESMAN], rowsAffected: [] })
      .mockResolvedValueOnce({
        recordset: [
          {
            filter_id: 2,
            name: 'Orphan',
            owner_code: 999,
            query: 'not-json',
            owner_first_name: null,
            owner_last_name: null,
          },
        ],
        rowsAffected: [],
      })

    const res = await buildApp().request('/onprem/longhaul/shipment-filters')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: [{ filter_id: 2, name: 'Orphan', owner_code: 999, query: 'not-json', owner: null }],
    })
  })

  it('converts stored date offsets in the query JSON back to absolute dates', async () => {
    tenantFind.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFind.mockResolvedValue({ legacyWindowsUsername: 'DOMAIN\\ada' })
    const storedQuery = JSON.stringify({ filters: { load_date: [0] } })
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [ACTIVE_SALESMAN], rowsAffected: [] })
      .mockResolvedValueOnce({
        recordset: [{ filter_id: 1, name: 'Today', query: storedQuery }],
        rowsAffected: [],
      })

    const res = await buildApp().request('/onprem/longhaul/shipment-filters')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<{ query: string }> }
    const parsed = JSON.parse(body.data[0]!.query) as { filters: { load_date: string[] } }
    const today = new Date()
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(parsed.filters.load_date).toEqual([expected])
  })

  it('uses the public-scope query when type=public', async () => {
    tenantFind.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFind.mockResolvedValue({ legacyWindowsUsername: 'DOMAIN\\ada' })
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [ACTIVE_SALESMAN], rowsAffected: [] })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] })

    const res = await buildApp().request('/onprem/longhaul/shipment-filters?type=public')

    expect(res.status).toBe(200)
    expect(executeSqlMock).toHaveBeenCalledTimes(2)
    // public scope takes no params and queries is_public = 1
    expect(executeSqlMock.mock.calls[1]?.[1]).toContain('is_public = 1')
    expect(executeSqlMock.mock.calls[1]?.[2]).toBeUndefined()
  })

  it('returns 422 MSSQL_NOT_CONFIGURED when the tenant has no connection string', async () => {
    tenantFind.mockResolvedValue({ mssqlConnectionString: null })

    const res = await buildApp().request('/onprem/longhaul/shipment-filters')

    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('MSSQL_NOT_CONFIGURED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 401 UNAUTHORIZED when there is no userId on the context', async () => {
    tenantFind.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })

    const res = await buildApp({ userId: undefined }).request('/onprem/longhaul/shipment-filters')

    expect(res.status).toBe(401)
    expect(((await res.json()) as { code: string }).code).toBe('UNAUTHORIZED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 422 LONGHAUL_USER_NOT_MAPPED when the TenantUser has no legacy username', async () => {
    tenantFind.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFind.mockResolvedValue({ legacyWindowsUsername: null })

    const res = await buildApp().request('/onprem/longhaul/shipment-filters')

    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('LONGHAUL_USER_NOT_MAPPED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 403 LONGHAUL_USER_NOT_FOUND when the legacy user is missing', async () => {
    tenantFind.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFind.mockResolvedValue({ legacyWindowsUsername: 'DOMAIN\\ghost' })
    executeSqlMock.mockResolvedValueOnce({ recordset: [], rowsAffected: [] })

    const res = await buildApp().request('/onprem/longhaul/shipment-filters')

    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('LONGHAUL_USER_NOT_FOUND')
    // resolved the user, but never queried for filters
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
  })

  it('returns 403 LONGHAUL_USER_NOT_FOUND when the legacy user is inactive', async () => {
    tenantFind.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFind.mockResolvedValue({ legacyWindowsUsername: 'DOMAIN\\ada' })
    executeSqlMock.mockResolvedValueOnce({
      recordset: [{ ...ACTIVE_SALESMAN, active: 'N' }],
      rowsAffected: [],
    })

    const res = await buildApp().request('/onprem/longhaul/shipment-filters')

    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('LONGHAUL_USER_NOT_FOUND')
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
  })

  it('returns 500 INTERNAL_ERROR when the executor call fails', async () => {
    tenantFind.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFind.mockResolvedValue({ legacyWindowsUsername: 'DOMAIN\\ada' })
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [ACTIVE_SALESMAN], rowsAffected: [] })
      .mockRejectedValueOnce(new Error('executor down'))

    const res = await buildApp().request('/onprem/longhaul/shipment-filters')

    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('INTERNAL_ERROR')
  })
})
