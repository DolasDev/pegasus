// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct longhaul /users/me handler.
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

import { longhaulUsersMeHandler } from './users-me'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'

const tenantFindUnique = db.tenant.findUnique as unknown as Mock
const tenantUserFindUnique = db.tenantUser.findUnique as unknown as Mock
const executeSqlMock = executeSql as unknown as Mock

function buildApp({ userId }: { userId: string | null } = { userId: 'user-1' }) {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    if (userId !== null) c.set('userId', userId)
    await next()
  })
  app.get('/onprem/longhaul/users/me', longhaulUsersMeHandler)
  return app
}

describe('GET longhaul/users/me (cloud-direct)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the mapped legacy user in { data } shape', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFindUnique.mockResolvedValue({ legacyWindowsUsername: 'JDOE' })
    executeSqlMock.mockResolvedValue({
      recordset: [{ code: 42, first_name: 'Jane', last_name: 'Doe', active: 'Y' }],
      rowsAffected: [],
    })

    const res = await buildApp().request('/onprem/longhaul/users/me')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: { code: 42, first_name: 'Jane', last_name: 'Doe', active: 'Y' },
    })
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
    expect(executeSqlMock).toHaveBeenCalledWith(
      'Server=a,1433',
      'SELECT * FROM v_longhaul_salesman WHERE LOWER(win_username) = LOWER(@u)',
      { params: [{ name: 'u', value: 'JDOE' }] },
    )
  })

  it('returns 422 MSSQL_NOT_CONFIGURED when the tenant has no connection string', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: null })

    const res = await buildApp().request('/onprem/longhaul/users/me')

    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('MSSQL_NOT_CONFIGURED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 401 UNAUTHORIZED when there is no userId', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })

    const res = await buildApp({ userId: null }).request('/onprem/longhaul/users/me')

    expect(res.status).toBe(401)
    expect(((await res.json()) as { code: string }).code).toBe('UNAUTHORIZED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 422 LONGHAUL_USER_NOT_MAPPED when no legacyWindowsUsername is set', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFindUnique.mockResolvedValue({ legacyWindowsUsername: null })

    const res = await buildApp().request('/onprem/longhaul/users/me')

    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('LONGHAUL_USER_NOT_MAPPED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 403 LONGHAUL_USER_NOT_FOUND when no salesman row matches', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFindUnique.mockResolvedValue({ legacyWindowsUsername: 'JDOE' })
    executeSqlMock.mockResolvedValue({ recordset: [], rowsAffected: [] })

    const res = await buildApp().request('/onprem/longhaul/users/me')

    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('LONGHAUL_USER_NOT_FOUND')
  })

  it('returns 403 LONGHAUL_USER_NOT_FOUND when the matched user is inactive', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFindUnique.mockResolvedValue({ legacyWindowsUsername: 'JDOE' })
    executeSqlMock.mockResolvedValue({
      recordset: [{ code: 42, first_name: 'Jane', last_name: 'Doe', active: 'N' }],
      rowsAffected: [],
    })

    const res = await buildApp().request('/onprem/longhaul/users/me')

    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('LONGHAUL_USER_NOT_FOUND')
  })

  it('returns 500 when the executor call fails', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFindUnique.mockResolvedValue({ legacyWindowsUsername: 'JDOE' })
    executeSqlMock.mockRejectedValue(new Error('executor down'))

    const res = await buildApp().request('/onprem/longhaul/users/me')

    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('INTERNAL_ERROR')
  })
})
