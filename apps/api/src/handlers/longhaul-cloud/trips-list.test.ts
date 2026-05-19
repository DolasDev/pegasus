// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct longhaul GET /trips (LIST) handler.
//
// Prisma and the mssql-executor client are mocked so the test never touches
// Postgres or the executor Lambda. The key round-trip-discipline assertion is
// that executeSql is called EXACTLY ONCE — the on-prem repo made two calls
// (trips list + a separate TripNotes fetch); this handler collapses them.
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

import { longhaulTripsListHandler } from './trips-list'
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
  app.get('/onprem/longhaul/trips', longhaulTripsListHandler)
  return app
}

describe('GET longhaul/trips (cloud-direct LIST)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the trips list in { data, meta } shape with notes parsed', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValue({
      recordset: [
        { id: 7, trip_title: 'Trip 7', notes: '[{"id":1,"note":"hello"}]' },
        { id: 8, trip_title: 'Trip 8', notes: null },
      ],
      rowsAffected: [],
    })

    const res = await buildApp().request('/onprem/longhaul/trips')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: [
        { id: 7, trip_title: 'Trip 7', notes: [{ id: 1, note: 'hello' }] },
        { id: 8, trip_title: 'Trip 8', notes: [] },
      ],
      meta: { count: 2 },
    })
    // Round-trip discipline: exactly ONE executor call (down from 2 on-prem).
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
  })

  it('makes exactly one round trip with no filters', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValue({ recordset: [], rowsAffected: [] })

    const res = await buildApp().request('/onprem/longhaul/trips')

    expect(res.status).toBe(200)
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
    const [, sql, opts] = executeSqlMock.mock.calls[0] as [string, string, { params: unknown[] }]
    // No outer WHERE clause when no filters supplied — the only WHERE in the
    // SQL is the correlated notes subquery's `WHERE n.tripId = ...`.
    expect(sql.match(/WHERE/g)).toHaveLength(1)
    expect(sql).toContain('WHERE n.tripId')
    expect(opts.params).toEqual([])
    // The notes fetch is collapsed into the single query, not a second call.
    expect(sql).toContain('FOR JSON PATH')
  })

  it('binds filter values as @name parameters — no string interpolation', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValue({ recordset: [], rowsAffected: [] })

    const filters = JSON.stringify({
      id: '42',
      driver_id: { label: 'Joe', value: 5 },
      TripStatus_id: [{ value: 1 }, { value: 2 }],
      internal_status: [{ value: 'active' }],
      weight: [1000, 5000],
    })
    const res = await buildApp().request(
      `/onprem/longhaul/trips?filters=${encodeURIComponent(filters)}`,
    )

    expect(res.status).toBe(200)
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
    const [, sql, opts] = executeSqlMock.mock.calls[0] as [
      string,
      string,
      { params: Array<{ name: string; value: unknown }> },
    ]
    // The SQL references @-prefixed param placeholders, never raw values.
    expect(sql).toContain('TripMaster.id = @p0')
    expect(sql).not.toContain("'42'")
    expect(sql).not.toContain('5000')
    // All filter values are carried as bound params.
    const values = opts.params.map((p) => p.value)
    expect(values).toContain('42')
    expect(values).toContain(5)
    expect(values).toContain(1)
    expect(values).toContain(2)
    expect(values).toContain('active')
    expect(values).toContain(1000)
    expect(values).toContain(5000)
  })

  it('returns 400 for malformed filters JSON', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })

    const res = await buildApp().request('/onprem/longhaul/trips?filters=not-json')

    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('VALIDATION_ERROR')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 422 MSSQL_NOT_CONFIGURED when the tenant has no connection string', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: null })

    const res = await buildApp().request('/onprem/longhaul/trips')

    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('MSSQL_NOT_CONFIGURED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the executor call fails', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockRejectedValue(new Error('executor down'))

    const res = await buildApp().request('/onprem/longhaul/trips')

    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('INTERNAL_ERROR')
  })
})
