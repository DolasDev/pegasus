// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct PegII dashboard handler.
//
// Prisma and the mssql-executor client are mocked so the test never touches
// Postgres or the executor Lambda. Mirrors longhaul-cloud/zones.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'

vi.mock('../db', () => ({
  db: { tenant: { findUnique: vi.fn() } },
}))
vi.mock('../lib/mssql-executor-client', () => ({
  executeSql: vi.fn(),
}))

import { dashboardPegiiHandler } from './dashboard-pegii'
import { db } from '../db'
import { executeSql } from '../lib/mssql-executor-client'

const findUnique = db.tenant.findUnique as unknown as Mock
const executeSqlMock = executeSql as unknown as Mock

function buildApp() {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    await next()
  })
  app.get('/dashboard/pegii', dashboardPegiiHandler)
  return app
}

describe('GET /dashboard/pegii (cloud-direct)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps the three view recordsets into the dashboard payload', async () => {
    const newOrders = [{ move_count: 5, movetype: 'I', move_desc: 'Import' }]
    const inTransit = [{ move_count: 2, movetype: 'E', move_desc: 'Export' }]
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValue({
      recordset: newOrders,
      recordsets: [newOrders, inTransit, [{ TotalInvoicesYTD: 12345.67 }]],
      rowsAffected: [],
    })

    const res = await buildApp().request('/dashboard/pegii')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: {
        newOrders: [{ move_count: 5, movetype: 'I', move_desc: 'Import' }],
        inTransit: [{ move_count: 2, movetype: 'E', move_desc: 'Export' }],
        totalInvoicesYtd: 12345.67,
      },
    })
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
  })

  it('defaults totalInvoicesYtd to 0 when the scalar recordset is empty', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValue({
      recordset: [],
      recordsets: [[], [], []],
      rowsAffected: [],
    })

    const res = await buildApp().request('/dashboard/pegii')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: { newOrders: [], inTransit: [], totalInvoicesYtd: 0 },
    })
  })

  it('returns 422 MSSQL_NOT_CONFIGURED when the tenant has no connection string', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: null })

    const res = await buildApp().request('/dashboard/pegii')

    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('MSSQL_NOT_CONFIGURED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the executor call fails', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockRejectedValue(new Error('executor down'))

    const res = await buildApp().request('/dashboard/pegii')

    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('INTERNAL_ERROR')
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
  })
})
