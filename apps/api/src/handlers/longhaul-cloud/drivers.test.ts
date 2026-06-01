// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct longhaul /drivers handler.
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

import { longhaulDriversHandler } from './drivers'
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
  app.get('/onprem/longhaul/drivers', longhaulDriversHandler)
  return app
}

describe('GET longhaul/drivers (cloud-direct)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns drivers with lowercase keys in { data: [...] } shape', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValue({
      recordset: [
        { driver_id: 1, driver_name: 'Alice', agent_code: 'AC1', active: true, type: 'OWNER' },
        { driver_id: 2, driver_name: 'Bob', agent_code: 'AC2', active: false, type: 'CONTRACT' },
      ],
      rowsAffected: [],
    })

    const res = await buildApp().request('/onprem/longhaul/drivers')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: [
        { driver_id: 1, driver_name: 'Alice', agent_code: 'AC1', active: true, type: 'OWNER' },
        { driver_id: 2, driver_name: 'Bob', agent_code: 'AC2', active: false, type: 'CONTRACT' },
      ],
    })
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
    expect(executeSqlMock).toHaveBeenCalledWith(
      'Server=a,1433',
      expect.stringContaining('DRIVER_ID AS driver_id'),
    )
    // Active, real drivers only — kept in lockstep with /driver-planning.
    const sql = executeSqlMock.mock.calls[0]![1] as string
    expect(sql).toContain("ACTIVE = 'Y'")
    expect(sql).toContain('DRIVER_ID NOT IN (99994, 99995, 99996, 99997, 99998, 99999)')
  })

  it('returns 422 MSSQL_NOT_CONFIGURED when the tenant has no connection string', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: null })

    const res = await buildApp().request('/onprem/longhaul/drivers')

    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('MSSQL_NOT_CONFIGURED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the executor call fails', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockRejectedValue(new Error('executor down'))

    const res = await buildApp().request('/onprem/longhaul/drivers')

    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('INTERNAL_ERROR')
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
  })
})
