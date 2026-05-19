// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct longhaul /filter-options handler.
//
// Prisma and the mssql-executor client are mocked so the test never touches
// Postgres or the executor Lambda. LONGHAUL_CLIENT is pinned to 'qmm' so the
// asserted SQL includes a non-trivial moveTypesWhere fragment.
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

import { longhaulFilterOptionsHandler } from './filter-options'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'

const findUnique = db.tenant.findUnique as unknown as Mock
const executeSqlMock = executeSql as unknown as Mock

const EXPECTED_SQL =
  'SELECT move_type_desc, move_type FROM MoveType ' +
  "WHERE move_type in ('C','S','N','M','U') " +
  'ORDER BY move_type_desc ASC'

const ORIGINAL_CLIENT = process.env['LONGHAUL_CLIENT']

function buildApp() {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    await next()
  })
  app.get('/onprem/longhaul/filter-options', longhaulFilterOptionsHandler)
  return app
}

describe('GET longhaul/filter-options (cloud-direct)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['LONGHAUL_CLIENT'] = 'qmm'
  })

  afterAll(() => {
    if (ORIGINAL_CLIENT === undefined) delete process.env['LONGHAUL_CLIENT']
    else process.env['LONGHAUL_CLIENT'] = ORIGINAL_CLIENT
  })

  it('returns move types in { data: { moveType: [{ value, label }] } } shape', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValue({
      recordset: [
        { move_type_desc: 'Corporate', move_type: 'C' },
        { move_type_desc: 'National', move_type: 'N' },
      ],
      rowsAffected: [],
    })

    const res = await buildApp().request('/onprem/longhaul/filter-options')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: {
        moveType: [
          { value: 'C', label: 'Corporate' },
          { value: 'N', label: 'National' },
        ],
      },
    })
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
    expect(executeSqlMock).toHaveBeenCalledWith('Server=a,1433', EXPECTED_SQL)
  })

  it('returns 422 MSSQL_NOT_CONFIGURED when the tenant has no connection string', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: null })

    const res = await buildApp().request('/onprem/longhaul/filter-options')

    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('MSSQL_NOT_CONFIGURED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the executor call fails', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockRejectedValue(new Error('executor down'))

    const res = await buildApp().request('/onprem/longhaul/filter-options')

    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('INTERNAL_ERROR')
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
  })
})
