// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct longhaul /trip-statuses handler.
//
// Prisma and the mssql-executor client are mocked so the test never touches
// Postgres or the executor Lambda.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import { registerTestErrorHandler } from '../../test-helpers'

vi.mock('../../db', () => ({
  db: { tenant: { findUnique: vi.fn() } },
}))
vi.mock('../../lib/mssql-executor-client', () => ({
  executeSql: vi.fn(),
}))

import { longhaulTripStatusesHandler } from './trip-statuses'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'

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
  app.get('/onprem/longhaul/trip-statuses', longhaulTripStatusesHandler)
  return app
}

describe('GET longhaul/trip-statuses (cloud-direct)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the trip statuses in { data: [...] } shape', async () => {
    const rows = [
      { status_id: 1, status: 'Pending' },
      { status_id: 2, status: 'Dispatched' },
    ]
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValue({ recordset: rows, rowsAffected: [] })

    const res = await buildApp().request('/onprem/longhaul/trip-statuses')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: rows })
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
    expect(executeSqlMock).toHaveBeenCalledWith('Server=a,1433', 'SELECT * FROM MasterTripStatus')
  })

  it('returns 422 MSSQL_NOT_CONFIGURED when the tenant has no connection string', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: null })

    const res = await buildApp().request('/onprem/longhaul/trip-statuses')

    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('MSSQL_NOT_CONFIGURED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the executor call fails', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockRejectedValue(new Error('executor down'))

    const res = await buildApp().request('/onprem/longhaul/trip-statuses')

    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('INTERNAL_ERROR')
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
  })
})
