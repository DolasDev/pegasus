// ---------------------------------------------------------------------------
// Unit tests for resolveLonghaulUser (cloud-write identity resolver).
//
// Prisma and the mssql-executor client are mocked so the test never touches
// Postgres or the executor Lambda. Asserts the same status/code parity the
// proxy's longhaul-user middleware enforces.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

vi.mock('../db', () => ({
  db: {
    tenant: { findUnique: vi.fn() },
    tenantUser: { findUnique: vi.fn() },
  },
}))
vi.mock('./mssql-executor-client', () => ({
  executeSql: vi.fn(),
}))

import { resolveLonghaulUser } from './longhaul-cloud-user'
import { db } from '../db'
import { executeSql } from './mssql-executor-client'

const tenantFindUnique = db.tenant.findUnique as unknown as Mock
const tenantUserFindUnique = db.tenantUser.findUnique as unknown as Mock
const executeSqlMock = executeSql as unknown as Mock

describe('resolveLonghaulUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the legacy salesman code for a Cognito user', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFindUnique.mockResolvedValue({ legacyWindowsUsername: 'JDOE' })
    executeSqlMock.mockResolvedValue({
      recordset: [{ code: 42, first_name: 'Jane', active: 'Y' }],
      recordsets: [[{ code: 42 }]],
      rowsAffected: [],
    })

    const res = await resolveLonghaulUser({ tenantId: 't1', userId: 'u1' })

    expect(res).toMatchObject({ ok: true, connectionString: 'Server=a,1433', code: 42 })
    expect(executeSqlMock).toHaveBeenCalledWith(
      'Server=a,1433',
      'SELECT * FROM v_longhaul_salesman WHERE LOWER(win_username) = LOWER(@u)',
      { params: [{ name: 'u', value: 'JDOE' }] },
    )
  })

  it('returns 422 MSSQL_NOT_CONFIGURED when the tenant has no connection string', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: null })

    const res = await resolveLonghaulUser({ tenantId: 't1', userId: 'u1' })

    expect(res).toMatchObject({ ok: false, status: 422, code: 'MSSQL_NOT_CONFIGURED' })
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 422 LONGHAUL_USER_NOT_MAPPED when no legacyWindowsUsername is set', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFindUnique.mockResolvedValue({ legacyWindowsUsername: null })

    const res = await resolveLonghaulUser({ tenantId: 't1', userId: 'u1' })

    expect(res).toMatchObject({ ok: false, status: 422, code: 'LONGHAUL_USER_NOT_MAPPED' })
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 403 LONGHAUL_USER_NOT_FOUND when no salesman row matches', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFindUnique.mockResolvedValue({ legacyWindowsUsername: 'JDOE' })
    executeSqlMock.mockResolvedValue({ recordset: [], recordsets: [[]], rowsAffected: [] })

    const res = await resolveLonghaulUser({ tenantId: 't1', userId: 'u1' })

    expect(res).toMatchObject({ ok: false, status: 403, code: 'LONGHAUL_USER_NOT_FOUND' })
  })

  it('returns 403 LONGHAUL_USER_NOT_FOUND when the matched user is inactive', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFindUnique.mockResolvedValue({ legacyWindowsUsername: 'JDOE' })
    executeSqlMock.mockResolvedValue({
      recordset: [{ code: 42, active: 'N' }],
      recordsets: [[{ code: 42, active: 'N' }]],
      rowsAffected: [],
    })

    const res = await resolveLonghaulUser({ tenantId: 't1', userId: 'u1' })

    expect(res).toMatchObject({ ok: false, status: 403, code: 'LONGHAUL_USER_NOT_FOUND' })
  })

  it('returns 503 MSSQL_UNAVAILABLE when the executor lookup throws', async () => {
    tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    tenantUserFindUnique.mockResolvedValue({ legacyWindowsUsername: 'JDOE' })
    executeSqlMock.mockRejectedValue(new Error('executor down'))

    const res = await resolveLonghaulUser({ tenantId: 't1', userId: 'u1' })

    expect(res).toMatchObject({ ok: false, status: 503, code: 'MSSQL_UNAVAILABLE' })
  })

  describe('M2M path (no Cognito userId)', () => {
    it('returns 401 UNAUTHORIZED when there is neither a user nor an API client', async () => {
      tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })

      const res = await resolveLonghaulUser({ tenantId: 't1' })

      expect(res).toMatchObject({ ok: false, status: 401, code: 'UNAUTHORIZED' })
      expect(executeSqlMock).not.toHaveBeenCalled()
    })

    it('returns 403 FORBIDDEN when the API client lacks longhaul:write', async () => {
      tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })

      const res = await resolveLonghaulUser({
        tenantId: 't1',
        apiClient: { scopes: ['longhaul:read'] },
      })

      expect(res).toMatchObject({ ok: false, status: 403, code: 'FORBIDDEN' })
      expect(executeSqlMock).not.toHaveBeenCalled()
    })

    it('resolves with code null when the API client has longhaul:write', async () => {
      tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })

      const res = await resolveLonghaulUser({
        tenantId: 't1',
        apiClient: { scopes: ['longhaul:write'] },
      })

      expect(res).toEqual({
        ok: true,
        connectionString: 'Server=a,1433',
        code: null,
        user: null,
      })
      expect(executeSqlMock).not.toHaveBeenCalled()
    })

    it('honors a custom requiredScope', async () => {
      tenantFindUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })

      const res = await resolveLonghaulUser({
        tenantId: 't1',
        apiClient: { scopes: ['longhaul:write'] },
        requiredScope: 'longhaul:admin',
      })

      expect(res).toMatchObject({ ok: false, status: 403, code: 'FORBIDDEN' })
    })
  })
})
