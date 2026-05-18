// ---------------------------------------------------------------------------
// Unit tests for the Phase 0 longhaul MSSQL feasibility diagnostic.
//
// getPool is mocked so the test never opens a real TDS connection. The tests
// run in declared order on purpose: the handler tracks cold/warm state in a
// module-level flag, so the first invocation is cold and later ones warm.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryMock = vi.fn()

vi.mock('./lib/mssql', () => ({
  getPool: vi.fn(async () => ({
    request: () => ({ query: queryMock }),
  })),
}))

import { handler } from './longhaul-mssql-diagnostic'

describe('longhaul mssql diagnostic handler', () => {
  beforeEach(() => {
    queryMock.mockReset()
    queryMock.mockResolvedValue({ recordset: [{ n: 1 }] })
  })

  it('runs SELECT 1 and reports latency, cold on the first invocation', async () => {
    const res = await handler({ connectionString: 'Server=test;Database=db', label: 'cold' })
    expect(res.ok).toBe(true)
    expect(res.coldStart).toBe(true)
    expect(res.label).toBe('cold')
    expect(typeof res.totalMs).toBe('number')
    expect(typeof res.connectMs).toBe('number')
    expect(typeof res.queryMs).toBe('number')
    expect(queryMock).toHaveBeenCalledWith('SELECT 1 AS n')
  })

  it('reports coldStart false on a warm reinvocation', async () => {
    const res = await handler({ connectionString: 'Server=test;Database=db', label: 'warm' })
    expect(res.ok).toBe(true)
    expect(res.coldStart).toBe(false)
  })

  it('throws when connectionString is missing', async () => {
    await expect(handler({})).rejects.toThrow('connectionString is required')
  })

  it('returns ok:false with the error message when the query fails', async () => {
    queryMock.mockRejectedValueOnce(new Error('TDS handshake timeout'))
    const res = await handler({ connectionString: 'Server=unreachable' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('TDS handshake timeout')
  })
})
