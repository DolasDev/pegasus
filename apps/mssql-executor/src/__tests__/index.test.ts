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
    queryMock.mockResolvedValue({
      recordset: [{ max: '1.3.7' }],
      recordsets: [[{ max: '1.3.7' }]],
      rowsAffected: [1],
    })
  })

  it('runs the query and returns the recordset', async () => {
    const res = await execute({ connectionString: 'Server=a,1433', sql: 'SELECT 1' })
    expect(res).toEqual({
      ok: true,
      recordset: [{ max: '1.3.7' }],
      recordsets: [[{ max: '1.3.7' }]],
      rowsAffected: [1],
    })
    expect(queryMock).toHaveBeenCalledWith('SELECT 1')
  })

  it('surfaces all statement result sets for a multi-statement batch', async () => {
    const tripRow = { id: 42, TripStatus_id: 1 }
    const activityRow = { id: 9, TripMaster_id: 42 }
    const noteRow = { id: 7, tripId: 42, note: 'hi' }
    queryMock.mockResolvedValueOnce({
      // mssql gives both: recordset = first set; recordsets = full breakdown.
      recordset: [tripRow],
      recordsets: [[tripRow], [activityRow], [noteRow]],
      rowsAffected: [1, 1, 1],
    })

    const res = await execute({
      connectionString: 'Server=multi,1433',
      sql: 'SELECT 1; SELECT 2; SELECT 3;',
    })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    // `recordset` stays the FIRST set (backward compatibility for the 12
    // existing single-statement cloud handlers).
    expect(res.recordset).toEqual([tripRow])
    // `recordsets` carries every statement's rows in order.
    expect(res.recordsets).toEqual([[tripRow], [activityRow], [noteRow]])
  })

  it('falls back to wrapping recordset when the driver does not expose recordsets', async () => {
    // Defensive: an older mssql build (or a partial mock) may only return
    // `recordset`. The executor should still populate `recordsets`.
    queryMock.mockResolvedValueOnce({ recordset: [{ a: 1 }], rowsAffected: [1] })
    const res = await execute({ connectionString: 'Server=fallback,1433', sql: 'SELECT 1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.recordsets).toEqual([[{ a: 1 }]])
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
