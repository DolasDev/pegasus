// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct longhaul GET /shipments LIST handler.
//
// Prisma and the mssql-executor client are mocked so the test never touches
// Postgres or the executor Lambda. The three round trips (base query,
// combined enrichment UNION, extra_locations) are stubbed by inspecting the
// SQL text passed to executeSql.
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

import { longhaulShipmentsListHandler } from './shipments-list'
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
  app.get('/onprem/longhaul/shipments', longhaulShipmentsListHandler)
  return app
}

/** JSON-encode a payload the way the FOR JSON PATH columns return it. */
function payload(obj: Record<string, unknown>): string {
  return JSON.stringify(obj)
}

/**
 * Wire up executeSql to answer the three round trips by matching SQL text:
 *   1. base query   — contains `FROM v_longhaul_shipments_v2`
 *   2. enrichment   — contains `UNION ALL`
 *   3. extra_locs   — contains `pegasus_extra_location`
 */
function stubExecutor(opts: {
  shipments?: unknown[]
  enrichment?: unknown[]
  extraLocations?: unknown[]
  extraLocationsError?: boolean
}) {
  executeSqlMock.mockImplementation((_conn: string, sql: string) => {
    if (sql.includes('UNION ALL')) {
      return Promise.resolve({ recordset: opts.enrichment ?? [], rowsAffected: [] })
    }
    if (sql.includes('pegasus_extra_location')) {
      if (opts.extraLocationsError) return Promise.reject(new Error('Invalid object name'))
      return Promise.resolve({ recordset: opts.extraLocations ?? [], rowsAffected: [] })
    }
    // base query
    return Promise.resolve({ recordset: opts.shipments ?? [], rowsAffected: [] })
  })
}

describe('GET longhaul/shipments (cloud-direct)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns enriched shipments in { data, meta: { count } } shape', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433', longhaulClient: 'nwi' })
    stubExecutor({
      shipments: [
        {
          order_num: 100,
          pack_date2: '2026-01-01',
          load_date2: '2026-01-02',
          del_date2: '2026-01-03',
        },
      ],
      enrichment: [
        // one real activity for order 100
        {
          __src: 'activity',
          __order_num: 100,
          __payload: payload({
            id: 1,
            order_num: 100,
            ActivityType_code: 'PACK',
            activityType_code: 'PACK',
            actual_date: null,
            planned_start: '2026-01-01',
            trip_status_id: 7,
            TripMaster_id: 55,
            driver_name: 'Jane',
            activityType_abbreviation: 'PK',
          }),
        },
        // coverage for order 100
        {
          __src: 'coverage',
          __order_num: 100,
          __payload: payload({ order_num: 100, activity_code: 'PACK', is_covered: true }),
        },
        // activity-type catalogue rows
        { __src: 'type', __order_num: null, __payload: payload({ code: 'LOAD', name: 'Load' }) },
        { __src: 'type', __order_num: null, __payload: payload({ code: 'RDEL', name: 'Deliver' }) },
      ],
      extraLocations: [],
    })

    const res = await buildApp().request('/onprem/longhaul/shipments')

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>
      meta: { count: number }
    }
    expect(body.meta.count).toBe(1)
    expect(body.data).toHaveLength(1)

    const shipment = body.data[0]!
    // trip-info enrichment ran (driver_name + TripMaster_id merged from activity)
    expect(shipment['driver_name']).toBe('Jane')
    expect(shipment['TripMaster_id']).toBe(55)
    // buildShipmentActivities filled required templates: PACK pre-existing,
    // LOAD + RDEL generated.
    const activities = shipment['activities'] as Array<Record<string, unknown>>
    const codes = activities.map(
      (a) => (a['activityType'] as { code?: string } | undefined)?.code ?? a['ActivityType_code'],
    )
    expect(codes).toContain('PACK')
    expect(codes).toContain('LOAD')
    expect(codes).toContain('RDEL')
    // Regression: generated activities must carry the FULL activityType from the
    // catalogue (not a bare { code }), or the planning UI renders "undefined"
    // and can't gate date editing. LOAD + RDEL are generated → enriched from the
    // activity-types map.
    const load = activities.find(
      (a) => (a['activityType'] as { code?: string } | undefined)?.code === 'LOAD',
    )
    expect(load!['activityType']).toMatchObject({ code: 'LOAD', name: 'Load' })
    // packing_coverage attached
    expect(shipment['packing_coverage']).toMatchObject({ order_num: 100, is_covered: true })
    // extras present (UNPK etc.)
    expect(Array.isArray(shipment['extraActivities'])).toBe(true)
  })

  it('makes exactly 3 MSSQL round trips (base + combined enrichment + extra-locations)', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433', longhaulClient: 'nwi' })
    stubExecutor({
      shipments: [{ order_num: 100 }],
      enrichment: [],
      extraLocations: [],
    })

    await buildApp().request('/onprem/longhaul/shipments')

    // On-prem fans out into 5 round trips; the cloud-direct handler does 3.
    expect(executeSqlMock).toHaveBeenCalledTimes(3)
  })

  it('selects the Longhaul_ActivityType edit flags in the enrichment query', async () => {
    // Regression: without `isCanEditDates` / `isHasETA` the driver-planning date
    // pickers stay locked because the gate flags arrive undefined.
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433', longhaulClient: 'nwi' })
    stubExecutor({ shipments: [{ order_num: 100 }], enrichment: [], extraLocations: [] })

    await buildApp().request('/onprem/longhaul/shipments')

    const enrichmentCall = executeSqlMock.mock.calls.find((call) =>
      String(call[1]).includes("'activity' AS __src"),
    )
    expect(enrichmentCall).toBeDefined()
    const sql = String(enrichmentCall![1])
    expect(sql).toContain('at.isCanEditDates AS activityType_isCanEditDates')
    expect(sql).toContain('at.isHasETA AS activityType_isHasETA')
  })

  it('skips the enrichment round trips when the base query returns no rows', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433', longhaulClient: 'nwi' })
    stubExecutor({ shipments: [] })

    const res = await buildApp().request('/onprem/longhaul/shipments')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: [], meta: { count: 0 } })
    // Only the base query runs — no order_nums to enrich.
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
  })

  it('binds searchTerm as a parameter and applies it to the base query', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433', longhaulClient: 'nwi' })
    stubExecutor({ shipments: [] })

    await buildApp().request('/onprem/longhaul/shipments?searchTerm=abc')

    const baseCall = executeSqlMock.mock.calls.find((call) => String(call[0]).includes('Server'))
    const [, sql, opts] = baseCall as [string, string, { params: Array<{ value: unknown }> }]
    expect(sql).toContain('shipper_name')
    // searchTerm 'abc' bound (lowercased) — never string-concatenated.
    expect(opts.params.some((p) => String(p.value).includes('abc'))).toBe(true)
  })

  it('passes filter values as bound params, not concatenated SQL', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433', longhaulClient: 'nwi' })
    stubExecutor({ shipments: [] })

    const filters = JSON.stringify({
      filters: { origin: [{ value: 'CA' }], move_type: [{ value: 'H' }] },
    })
    await buildApp().request(`/onprem/longhaul/shipments?filters=${encodeURIComponent(filters)}`)

    const [, sql, opts] = executeSqlMock.mock.calls[0] as [
      string,
      string,
      { params: Array<{ value: unknown }> },
    ]
    expect(sql).toContain('shipper_state IN (@')
    expect(sql).not.toContain("'CA'")
    expect(opts.params.map((p) => p.value)).toContain('CA')
    expect(opts.params.map((p) => p.value)).toContain('H')
  })

  // Zone filters are the only geographic filter that doesn't read a column off
  // the shipments view: the dropdown's values come from v_longhaul_zones
  // (`zone_code`) while the predicate reads `zone` off v_longhaul_states, reached
  // through the origin/destination joins. That indirection is easy to break and
  // fails silently — a wrong alias just returns nothing — so pin both sides.
  describe('zone filters', () => {
    async function sqlForFilters(filters: Record<string, unknown>) {
      findUnique.mockResolvedValue({
        mssqlConnectionString: 'Server=a,1433',
        longhaulClient: 'nwi',
      })
      stubExecutor({ shipments: [] })
      const encoded = encodeURIComponent(JSON.stringify({ filters }))
      await buildApp().request(`/onprem/longhaul/shipments?filters=${encoded}`)
      return executeSqlMock.mock.calls[0] as [string, string, { params: Array<{ value: unknown }> }]
    }

    it('filters origin_zone on the origin-state join, as a bound param', async () => {
      // Shape is exactly what the planning screen's react-select sends.
      const [, sql, opts] = await sqlForFilters({
        origin_zone: [{ label: 'Northeast', value: 'NE' }],
      })

      expect(sql).toContain('os.zone IN (@')
      expect(sql).not.toContain("'NE'")
      expect(opts.params.map((p) => p.value)).toContain('NE')
      // The predicate is meaningless without the join that defines `os`.
      expect(sql).toContain('LEFT JOIN v_longhaul_states AS os')
    })

    it('filters destination_zone on the destination-state join, not the origin one', async () => {
      const [, sql, opts] = await sqlForFilters({
        destination_zone: [{ label: 'Southeast', value: 'SE' }],
      })

      expect(sql).toContain('ds.zone IN (@')
      expect(sql).not.toContain('os.zone IN (')
      expect(opts.params.map((p) => p.value)).toContain('SE')
      expect(sql).toContain('LEFT JOIN v_longhaul_states AS ds')
    })

    it('binds every selected zone when several are picked', async () => {
      const [, sql, opts] = await sqlForFilters({
        origin_zone: [{ value: 'NE' }, { value: 'SE' }, { value: 'MW' }],
      })

      expect(sql).toContain('os.zone IN (@p0, @p1, @p2)')
      expect(opts.params.map((p) => p.value)).toEqual(expect.arrayContaining(['NE', 'SE', 'MW']))
    })

    it('adds no zone predicate when the selection is empty', async () => {
      const [, sql] = await sqlForFilters({ origin_zone: [], destination_zone: [] })

      expect(sql).not.toContain('os.zone IN')
      expect(sql).not.toContain('ds.zone IN')
    })

    it('applies origin and destination zones together', async () => {
      const [, sql] = await sqlForFilters({
        origin_zone: [{ value: 'NE' }],
        destination_zone: [{ value: 'SE' }],
      })

      expect(sql).toContain('os.zone IN (@')
      expect(sql).toContain('ds.zone IN (@')
    })

    // Legacy parity, ported verbatim from the on-prem repository: a searchTerm of
    // 3+ chars takes an `else if` branch that skips EVERY filter, zones included.
    // Surprising, but intended — pin it so a change here is a deliberate one.
    it('drops zone filters when a searchTerm is present (legacy else-if parity)', async () => {
      findUnique.mockResolvedValue({
        mssqlConnectionString: 'Server=a,1433',
        longhaulClient: 'nwi',
      })
      stubExecutor({ shipments: [] })
      const encoded = encodeURIComponent(
        JSON.stringify({ filters: { origin_zone: [{ value: 'NE' }] } }),
      )

      await buildApp().request(`/onprem/longhaul/shipments?filters=${encoded}&searchTerm=abc`)

      const [, sql] = executeSqlMock.mock.calls[0] as [string, string, unknown]
      expect(sql).not.toContain('os.zone IN')
      expect(sql).toContain('shipper_name')
    })
  })

  it('applies the post-fetch TripStatus_id filter', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433', longhaulClient: 'nwi' })
    stubExecutor({
      shipments: [{ order_num: 1 }, { order_num: 2 }],
      enrichment: [
        {
          __src: 'activity',
          __order_num: 1,
          __payload: payload({ order_num: 1, actual_date: null, trip_status_id: 3 }),
        },
        {
          __src: 'activity',
          __order_num: 2,
          __payload: payload({ order_num: 2, actual_date: null, trip_status_id: 9 }),
        },
      ],
      extraLocations: [],
    })

    const filters = JSON.stringify({ filters: { TripStatus_id: [{ value: 3 }] } })
    const res = await buildApp().request(
      `/onprem/longhaul/shipments?filters=${encodeURIComponent(filters)}`,
    )

    const body = (await res.json()) as { data: Array<{ order_num: number }> }
    expect(body.data.map((s) => s.order_num)).toEqual([1])
  })

  it('soft-fails when the extra_locations table does not exist', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433', longhaulClient: 'nwi' })
    stubExecutor({
      shipments: [{ order_num: 100 }],
      enrichment: [],
      extraLocationsError: true,
    })

    const res = await buildApp().request('/onprem/longhaul/shipments')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<Record<string, unknown>> }
    expect(body.data[0]!['extra_locations']).toEqual([])
  })

  it('returns 400 RESULT_LIMIT_EXCEEDED when more than 1000 shipments enrich', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433', longhaulClient: 'nwi' })
    const shipments = Array.from({ length: 1001 }, (_, i) => ({ order_num: i + 1 }))
    stubExecutor({ shipments, enrichment: [], extraLocations: [] })

    const res = await buildApp().request('/onprem/longhaul/shipments')

    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('RESULT_LIMIT_EXCEEDED')
  })

  it('returns 400 VALIDATION_ERROR on invalid filters JSON', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433', longhaulClient: 'nwi' })
    stubExecutor({ shipments: [] })

    const res = await buildApp().request('/onprem/longhaul/shipments?filters=not-json')

    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('VALIDATION_ERROR')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 422 MSSQL_NOT_CONFIGURED when the tenant has no connection string', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: null, longhaulClient: 'nwi' })

    const res = await buildApp().request('/onprem/longhaul/shipments')

    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('MSSQL_NOT_CONFIGURED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 422 LONGHAUL_CLIENT_NOT_CONFIGURED when the tenant has no longhaul client', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433', longhaulClient: null })

    const res = await buildApp().request('/onprem/longhaul/shipments')

    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('LONGHAUL_CLIENT_NOT_CONFIGURED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the executor call fails', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433', longhaulClient: 'nwi' })
    executeSqlMock.mockRejectedValue(new Error('executor down'))

    const res = await buildApp().request('/onprem/longhaul/shipments')

    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('INTERNAL_ERROR')
  })
})
