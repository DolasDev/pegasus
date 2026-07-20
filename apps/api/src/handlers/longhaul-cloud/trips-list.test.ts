// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct longhaul GET /trips (LIST) handler.
//
// Prisma and the mssql-executor client are mocked so the test never touches
// Postgres or the executor Lambda. The key round-trip-discipline assertion is
// that executeSql is called EXACTLY ONCE — the on-prem repo made two calls
// (trips list + a separate TripNotes fetch); this handler collapses them.
//
// Regression coverage (Phase 3.1): the UI sends the entire TripQuery
// (`{ searchTerm, filters: {...}, sortBy: {...} }`) URL-encoded into the
// `?filters=` param — NOT a flat filter object. The handler must read
// `parsed.filters` and `parsed.sortBy`. The filter / sortBy tests below send
// the realistic wire payload to keep that contract honest.
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

    // Realistic wire shape: the UI sends the WHOLE TripQuery (with `filters`
    // nested) URL-encoded into the `?filters=` param.
    const query = JSON.stringify({
      searchTerm: '',
      filters: {
        id: '42',
        driver_id: { label: 'Joe', value: 5 },
        TripStatus_id: [{ value: 1 }, { value: 2 }],
        internal_status: [{ value: 'active' }],
        weight: [1000, 5000],
      },
      sortBy: { value: 'planned_first_day', order: 'desc' },
    })
    const res = await buildApp().request(
      `/onprem/longhaul/trips?filters=${encodeURIComponent(query)}`,
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

  // Zone filters read `zone` off the origin/destination v_longhaul_states joins
  // rather than a column on TripMaster, and the same aliases (`os`/`ds`) also
  // feed the origin_zone_code / destination_zone_code SELECT columns. A wrong
  // alias returns nothing rather than erroring, so pin both sides.
  describe('zone filters', () => {
    async function sqlForFilters(filters: Record<string, unknown>) {
      findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
      executeSqlMock.mockResolvedValue({ recordset: [], rowsAffected: [] })
      const query = JSON.stringify({ searchTerm: '', filters, sortBy: {} })
      await buildApp().request(`/onprem/longhaul/trips?filters=${encodeURIComponent(query)}`)
      return executeSqlMock.mock.calls[0] as [
        string,
        string,
        { params: Array<{ name: string; value: unknown }> },
      ]
    }

    it('filters origin_zone on the origin-state join, as a bound param', async () => {
      const [, sql, opts] = await sqlForFilters({
        origin_zone: [{ label: 'Northeast', value: 'NE' }],
      })

      expect(sql).toContain('os.zone IN (@')
      expect(sql).not.toContain("'NE'")
      expect(opts.params.map((p) => p.value)).toContain('NE')
    })

    it('filters destination_zone on the destination-state join, not the origin one', async () => {
      const [, sql, opts] = await sqlForFilters({
        destination_zone: [{ label: 'Southeast', value: 'SE' }],
      })

      expect(sql).toContain('ds.zone IN (@')
      expect(sql).not.toContain('os.zone IN (')
      expect(opts.params.map((p) => p.value)).toContain('SE')
    })

    it('adds no zone predicate when the selection is empty', async () => {
      const [, sql] = await sqlForFilters({ origin_zone: [], destination_zone: [] })

      expect(sql).not.toContain('os.zone IN')
      expect(sql).not.toContain('ds.zone IN')
    })
  })

  // Origin / destination STATE filters. The StateDropdown emits the raw
  // v_longhaul_states row as `value`, whose PK column is `id` — NOT `state_id`.
  // The handler read `value.state_id` (undefined for the real payload), so the
  // predicate was silently dropped and every trip came back. Pin the actual wire
  // shape (`{ value: { id, geo_code, ... } }`) here.
  describe('state filters', () => {
    async function sqlForFilters(filters: Record<string, unknown>) {
      findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
      executeSqlMock.mockResolvedValue({ recordset: [], rowsAffected: [] })
      const query = JSON.stringify({ searchTerm: '', filters, sortBy: {} })
      await buildApp().request(`/onprem/longhaul/trips?filters=${encodeURIComponent(query)}`)
      return executeSqlMock.mock.calls[0] as [
        string,
        string,
        { params: Array<{ name: string; value: unknown }> },
      ]
    }

    it('filters origin on origin_state_id from the real dropdown row (id key)', async () => {
      const [, sql, opts] = await sqlForFilters({
        origin: [
          { value: { id: 55, geo_code: 'TX', geo_name: 'TEXAS', zone: '5' }, label: 'TEXAS (TX)' },
        ],
      })

      expect(sql).toContain('TripMaster.origin_state_id IN (@')
      expect(sql).not.toContain('55)')
      expect(opts.params.map((p) => p.value)).toContain(55)
    })

    it('filters destination on destination_state_id, not the origin column', async () => {
      const [, sql, opts] = await sqlForFilters({
        destination: [{ value: { id: 12, geo_code: 'CA' }, label: 'CALIFORNIA (CA)' }],
      })

      expect(sql).toContain('TripMaster.destination_state_id IN (@')
      expect(sql).not.toContain('TripMaster.origin_state_id IN (')
      expect(opts.params.map((p) => p.value)).toContain(12)
    })

    it('still honours the legacy state_id key', async () => {
      const [, sql, opts] = await sqlForFilters({
        origin: [{ value: { state_id: 7 } }],
      })

      expect(sql).toContain('TripMaster.origin_state_id IN (@')
      expect(opts.params.map((p) => p.value)).toContain(7)
    })

    it('adds no state predicate when the selection is empty', async () => {
      const [, sql] = await sqlForFilters({ origin: [], destination: [] })

      expect(sql).not.toContain('TripMaster.origin_state_id IN')
      expect(sql).not.toContain('TripMaster.destination_state_id IN')
    })
  })

  it('regression: applies filters.id from the nested wire shape (Phase 3.1)', async () => {
    // This is the test that would have caught the original bug: the UI sends
    // `?filters={"filters":{"id":"42"}}`, NOT `?filters={"id":"42"}`. The
    // handler must drill into `parsed.filters.id`.
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValue({ recordset: [], rowsAffected: [] })

    const query = JSON.stringify({
      searchTerm: '',
      filters: { id: '42' },
      sortBy: { value: 'planned_first_day', order: 'desc' },
    })
    const res = await buildApp().request(
      `/onprem/longhaul/trips?filters=${encodeURIComponent(query)}`,
    )

    expect(res.status).toBe(200)
    const [, sql, opts] = executeSqlMock.mock.calls[0] as [
      string,
      string,
      { params: Array<{ name: string; value: unknown }> },
    ]
    expect(sql).toContain('TripMaster.id = @p0')
    expect(opts.params.map((p) => p.value)).toContain('42')
  })

  it('regression: applies sortBy from the nested wire shape (Phase 3.1)', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValue({ recordset: [], rowsAffected: [] })

    const query = JSON.stringify({
      searchTerm: '',
      filters: {},
      sortBy: { value: 'planned_first_day', order: 'desc' },
    })
    const res = await buildApp().request(
      `/onprem/longhaul/trips?filters=${encodeURIComponent(query)}`,
    )

    expect(res.status).toBe(200)
    const [, sql] = executeSqlMock.mock.calls[0] as [string, string, unknown]
    // ORDER BY is built from the whitelisted column + direction.
    expect(sql).toContain('ORDER BY TripMaster.planned_first_day DESC')
  })

  it('ignores a sortBy whose column is not in the whitelist', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValue({ recordset: [], rowsAffected: [] })

    const query = JSON.stringify({
      filters: {},
      sortBy: { value: 'password_hash; DROP TABLE TripMaster--', order: 'desc' },
    })
    const res = await buildApp().request(
      `/onprem/longhaul/trips?filters=${encodeURIComponent(query)}`,
    )

    expect(res.status).toBe(200)
    const [, sql] = executeSqlMock.mock.calls[0] as [string, string, unknown]
    expect(sql).not.toContain('ORDER BY')
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
