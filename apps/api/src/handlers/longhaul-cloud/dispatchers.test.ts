// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct longhaul /dispatchers handler.
//
// Prisma and the mssql-executor client are mocked so the test never touches
// Postgres or the executor Lambda. LONGHAUL_CLIENT is set so
// getLonghaulClientConfig() resolves the dispatcher WHERE fragment.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterAll, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import { registerTestErrorHandler } from '../../test-helpers'

vi.mock('../../db', () => ({
  db: { tenant: { findUnique: vi.fn() } },
}))
vi.mock('../../lib/mssql-executor-client', () => ({
  executeSql: vi.fn(),
}))

import { longhaulDispatchersHandler } from './dispatchers'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'

const findUnique = db.tenant.findUnique as unknown as Mock
const executeSqlMock = executeSql as unknown as Mock

const ORIGINAL_LONGHAUL_CLIENT = process.env['LONGHAUL_CLIENT']

function buildApp() {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    await next()
  })
  app.get('/onprem/longhaul/dispatchers', longhaulDispatchersHandler)
  return app
}

describe('GET longhaul/dispatchers (cloud-direct)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // NWI client → dispatcherQuery = 'managed_by_id = 2021'
    process.env['LONGHAUL_CLIENT'] = 'nwi'
  })

  afterAll(() => {
    if (ORIGINAL_LONGHAUL_CLIENT === undefined) {
      delete process.env['LONGHAUL_CLIENT']
    } else {
      process.env['LONGHAUL_CLIENT'] = ORIGINAL_LONGHAUL_CLIENT
    }
  })

  it('returns the dispatcher rows in { data: [...] } shape', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    const rows = [
      { code: '2021', name: 'Dispatch One' },
      { code: '2099', name: 'Dispatch Two' },
    ]
    executeSqlMock.mockResolvedValue({ recordset: rows, rowsAffected: [] })

    const res = await buildApp().request('/onprem/longhaul/dispatchers')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: rows })
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
    expect(executeSqlMock).toHaveBeenCalledWith(
      'Server=a,1433',
      'SELECT * FROM v_longhaul_salesman WHERE managed_by_id = 2021',
    )
  })

  it('interpolates the QMM dispatcher query when LONGHAUL_CLIENT=qmm', async () => {
    process.env['LONGHAUL_CLIENT'] = 'qmm'
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValue({ recordset: [], rowsAffected: [] })

    const res = await buildApp().request('/onprem/longhaul/dispatchers')

    expect(res.status).toBe(200)
    expect(executeSqlMock).toHaveBeenCalledWith(
      'Server=a,1433',
      "SELECT * FROM v_longhaul_salesman WHERE roles like ('%cpd%')",
    )
  })

  it('returns 422 MSSQL_NOT_CONFIGURED when the tenant has no connection string', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: null })

    const res = await buildApp().request('/onprem/longhaul/dispatchers')

    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('MSSQL_NOT_CONFIGURED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the executor call fails', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockRejectedValue(new Error('executor down'))

    const res = await buildApp().request('/onprem/longhaul/dispatchers')

    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('INTERNAL_ERROR')
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
  })
})
