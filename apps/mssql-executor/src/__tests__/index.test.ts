import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks are built inside vi.hoisted so the vi.mock factory (hoisted to the top
// of the file) can reference them. Each test uses a distinct connection string
// so the module-level pool cache in index.ts never bleeds state between cases.
const { queryMock, inputMock, FakeConnectionPool } = vi.hoisted(() => {
  const queryMock = vi.fn()
  const inputMock = vi.fn()
  class FakeConnectionPool {
    connected = false
    constructor(public connStr: string) {}
    on = vi.fn()
    connect = vi.fn(async () => {
      this.connected = true
    })
    request = vi.fn(() => ({ input: inputMock, query: queryMock, timeout: 0 }))
  }
  return { queryMock, inputMock, FakeConnectionPool }
})

vi.mock('mssql', () => ({
  default: { ConnectionPool: FakeConnectionPool },
}))

import { execute, handler } from '../index'

describe('mssql-executor', () => {
  beforeEach(() => {
    queryMock.mockReset()
    inputMock.mockReset()
    queryMock.mockResolvedValue({ recordset: [{ max: '1.3.7' }], rowsAffected: [1] })
  })

  it('runs the query and returns the recordset', async () => {
    const res = await execute({ connectionString: 'Server=a,1433', sql: 'SELECT 1' })
    expect(res).toEqual({ ok: true, recordset: [{ max: '1.3.7' }], rowsAffected: [1] })
    expect(queryMock).toHaveBeenCalledWith('SELECT 1')
  })

  it('binds named parameters via request.input', async () => {
    await execute({
      connectionString: 'Server=b,1433',
      sql: 'SELECT * FROM t WHERE id = @id',
      params: [{ name: 'id', value: 42 }],
    })
    expect(inputMock).toHaveBeenCalledWith('id', 42)
  })

  it('rejects a payload missing connectionString or sql', async () => {
    const res = await execute({ connectionString: '', sql: 'SELECT 1' })
    expect(res).toEqual({ ok: false, code: 'BAD_REQUEST', error: expect.any(String) })
  })

  it('returns ok:false with QUERY_FAILED when the query throws', async () => {
    queryMock.mockRejectedValueOnce(new Error('Invalid object name longhaul_versions'))
    const res = await execute({ connectionString: 'Server=c,1433', sql: 'SELECT 1' })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('QUERY_FAILED')
      expect(res.error).toContain('Invalid object name')
    }
  })

  it('handler delegates to execute', async () => {
    const res = await handler({ connectionString: 'Server=d,1433', sql: 'SELECT 1' })
    expect(res.ok).toBe(true)
  })
})
