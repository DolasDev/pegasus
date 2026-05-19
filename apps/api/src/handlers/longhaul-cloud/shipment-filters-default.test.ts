// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct longhaul /shipment-filters/default handler.
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

import { longhaulShipmentFiltersDefaultHandler } from './shipment-filters-default'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'

const tenantFindUnique = db.tenant.findUnique as unknown as Mock
const tenantUserFindUnique = db.tenantUser.findUnique as unknown as Mock
const executeSqlMock = executeSql as unknown as Mock

const PATH = '/onprem/longhaul/shipment-filters/default'

/** An active salesman row as returned by v_longhaul_salesman. */
const ACTIVE_SALESMAN = { code: 42, win_username: 'jdoe', active: 'Y' }

function buildApp() {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('userId', 'user-1')
    c.set('correlationId', 'corr-1')
    await next()
  })
  app.get(PATH, longhaulShipmentFiltersDefaultHandler)
  return app
}

describe('GET longhaul/shipment-filters/default (cloud-direct)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the default filter with date offsets converted to absolute dates', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFindUnique.mockResolvedValue({ legacyWindowsUsername: 'jdoe' })
    const storedQuery = JSON.stringify({ filters: { load_date: [0] }, sortBy: {} })
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [ACTIVE_SALESMAN], rowsAffected: [] })
      .mockResolvedValueOnce({
        recordset: [{ filter_id: 7, name: 'My filter', query: storedQuery }],
        rowsAffected: [],
      })

    const res = await buildApp().request(PATH)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { filter_id: number; query: string } }
    expect(body.data.filter_id).toBe(7)
    // load_date offset 0 → today's date in YYYY-MM-DD form.
    const today = new Date()
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(JSON.parse(body.data.query)).toEqual({
      filters: { load_date: [expected] },
      sortBy: {},
    })
    // Two executor calls: salesman lookup + default-filter fetch.
    expect(executeSqlMock).toHaveBeenCalledTimes(2)
    expect(executeSqlMock).toHaveBeenNthCalledWith(2, 'Server=a,1433', expect.any(String), {
      params: [{ name: 'userId', value: 42 }],
    })
  })

  it('returns { data: null } when the user has no default filter', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFindUnique.mockResolvedValue({ legacyWindowsUsername: 'jdoe' })
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [ACTIVE_SALESMAN], rowsAffected: [] })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] })

    const res = await buildApp().request(PATH)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: null })
    expect(executeSqlMock).toHaveBeenCalledTimes(2)
  })

  it('returns 422 MSSQL_NOT_CONFIGURED when the tenant has no connection string', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: null })

    const res = await buildApp().request(PATH)

    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('MSSQL_NOT_CONFIGURED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 422 LONGHAUL_USER_NOT_MAPPED when the TenantUser has no windows username', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFindUnique.mockResolvedValue({ legacyWindowsUsername: null })

    const res = await buildApp().request(PATH)

    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('LONGHAUL_USER_NOT_MAPPED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 403 LONGHAUL_USER_NOT_FOUND when the legacy user is inactive or missing', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFindUnique.mockResolvedValue({ legacyWindowsUsername: 'jdoe' })
    executeSqlMock.mockResolvedValueOnce({ recordset: [], rowsAffected: [] })

    const res = await buildApp().request(PATH)

    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('LONGHAUL_USER_NOT_FOUND')
    // Only the salesman lookup ran — no default-filter fetch.
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
  })

  it('returns 403 LONGHAUL_USER_NOT_FOUND when the legacy user is marked inactive', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFindUnique.mockResolvedValue({ legacyWindowsUsername: 'jdoe' })
    executeSqlMock.mockResolvedValueOnce({
      recordset: [{ code: 42, win_username: 'jdoe', active: 'N' }],
      rowsAffected: [],
    })

    const res = await buildApp().request(PATH)

    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('LONGHAUL_USER_NOT_FOUND')
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
  })

  it('returns 500 when the executor call fails', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFindUnique.mockResolvedValue({ legacyWindowsUsername: 'jdoe' })
    executeSqlMock.mockRejectedValue(new Error('executor down'))

    const res = await buildApp().request(PATH)

    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('INTERNAL_ERROR')
  })
})
