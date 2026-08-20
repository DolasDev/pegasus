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
// The view's column list lives in @pegasus/longhaul-contracts — one source of
// truth shared with tenant-web, verified against a live tenant view by
// scripts/verify-longhaul-view-columns.ts.
import { LONGHAUL_SHIPMENT_VIEW_COLUMNS } from '@pegasus/longhaul-contracts'

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
        // activity-type catalog rows
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
    // catalog (not a bare { code }), or the planning UI renders "undefined"
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

  it('serializes coverage with INCLUDE_NULL_VALUES so an unset is_covered survives', async () => {
    // Regression: FOR JSON omits NULL-valued keys by default, so a coverage row
    // whose `is_covered` is NULL (the "OA Committed?" unset state) reached the
    // client with the key MISSING entirely. `undefined` fails the UI's `=== null`
    // tri-state check, so the unset rendered as "No" and the save looked lost.
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433', longhaulClient: 'nwi' })
    stubExecutor({ shipments: [{ order_num: 100 }], enrichment: [], extraLocations: [] })

    await buildApp().request('/onprem/longhaul/shipments')

    const enrichmentCall = executeSqlMock.mock.calls.find((call) =>
      String(call[1]).includes("'coverage' AS __src"),
    )
    expect(enrichmentCall).toBeDefined()
    const sql = String(enrichmentCall![1])
    expect(sql).toContain(
      '(SELECT cov.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES) AS __payload',
    )
  })

  it('serializes the activity and type payloads with INCLUDE_NULL_VALUES too', async () => {
    // Same class as the coverage bug above. No consumer distinguishes null from
    // undefined TODAY, so this is a landmine rather than a live defect — but the
    // same rows read via trip-detail (a plain SELECT) DO carry explicit nulls, so
    // one activity object had different key presence per route. 29,619 prod rows
    // drop `estimated_date` and 14,484 drop `driver_name` without this.
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433', longhaulClient: 'nwi' })
    stubExecutor({ shipments: [{ order_num: 100 }], enrichment: [], extraLocations: [] })

    await buildApp().request('/onprem/longhaul/shipments')

    const enrichmentCall = executeSqlMock.mock.calls.find((call) =>
      String(call[1]).includes("'activity' AS __src"),
    )
    expect(enrichmentCall).toBeDefined()
    const sql = String(enrichmentCall![1])
    // activity payload
    expect(sql).toContain('FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES) AS __payload')
    // activity-type catalog payload
    expect(sql).toContain(
      '(SELECT t.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES) AS __payload',
    )
    // every FOR JSON in the enrichment union must include nulls — none left behind
    const forJsonCount = (sql.match(/FOR JSON PATH/g) ?? []).length
    const includeNullCount = (sql.match(/INCLUDE_NULL_VALUES/g) ?? []).length
    expect(includeNullCount).toBe(forJsonCount)
  })

  it('keeps an explicitly null TripMaster_id and actual_date classified as untripped', async () => {
    // Pin: buildShipmentActivities filters untripped rows with loose `== null`, so
    // an explicit null must behave exactly like the previously-absent key.
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433', longhaulClient: 'nwi' })
    stubExecutor({
      shipments: [{ order_num: 100, pack_date2: '2026-01-01' }],
      enrichment: [
        {
          __src: 'activity',
          __order_num: 100,
          __payload: payload({
            id: 1,
            order_num: 100,
            ActivityType_code: 'PACK',
            activityType_code: 'PACK',
            TripMaster_id: null,
            actual_date: null,
            estimated_date: null,
            driver_name: null,
          }),
        },
        { __src: 'type', __order_num: null, __payload: payload({ code: 'PACK', name: 'Pack' }) },
      ],
      extraLocations: [],
    })

    const res = await buildApp().request('/onprem/longhaul/shipments')
    const body = (await res.json()) as { data: Array<Record<string, unknown>> }
    const activities = body.data[0]!['activities'] as Array<Record<string, unknown>>

    // The untripped PACK row survived rather than being dropped, and no template
    // was generated to duplicate it. Pre-existing rows carry ActivityType_code;
    // only generated ones get the nested activityType from the catalog.
    const packs = activities.filter(
      (a) =>
        ((a['activityType'] as { code?: string } | undefined)?.code ?? a['ActivityType_code']) ===
        'PACK',
    )
    expect(packs).toHaveLength(1)
    expect(packs[0]).toHaveProperty('id', 1)
    // The explicit nulls round-tripped as null rather than being stripped.
    expect(packs[0]).toHaveProperty('TripMaster_id', null)
    expect(packs[0]).toHaveProperty('actual_date', null)
  })

  it('carries an explicitly null is_covered through to packing_coverage', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433', longhaulClient: 'nwi' })
    stubExecutor({
      shipments: [{ order_num: 100 }],
      enrichment: [
        {
          __src: 'coverage',
          __order_num: 100,
          __payload: payload({ order_num: 100, activity_code: 'PACK', is_covered: null }),
        },
      ],
      extraLocations: [],
    })

    const res = await buildApp().request('/onprem/longhaul/shipments')
    const body = (await res.json()) as { data: Array<Record<string, unknown>> }
    const coverage = body.data[0]!['packing_coverage'] as Record<string, unknown>

    // The key must be PRESENT and null — not absent. The client distinguishes
    // "unset" from "no" purely by `is_covered === null`.
    expect(coverage).toHaveProperty('is_covered', null)
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
      // The predicate is meaningless without the subquery that defines `os`,
      // and that subquery must correlate on the ORIGIN state column.
      expect(sql).toContain('EXISTS (SELECT 1 FROM v_longhaul_states AS os')
      expect(sql).toContain('os.geo_code = v_longhaul_shipments_v2.shipper_state')
    })

    it('filters destination_zone on the destination-state join, not the origin one', async () => {
      const [, sql, opts] = await sqlForFilters({
        destination_zone: [{ label: 'Southeast', value: 'SE' }],
      })

      expect(sql).toContain('ds.zone IN (@')
      expect(sql).not.toContain('os.zone IN (')
      expect(opts.params.map((p) => p.value)).toContain('SE')
      expect(sql).toContain('EXISTS (SELECT 1 FROM v_longhaul_states AS ds')
      expect(sql).toContain('ds.geo_code = v_longhaul_shipments_v2.consignee_state')
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

  // `move_type` has no column of its own — it filters `import_export`, the same
  // column Is_Trip_Planning ANDs its per-client eligibility whitelist onto. So
  // the two predicates can contradict each other, and when they do the list is
  // empty for every date range, zone and tenant with nothing to indicate why.
  // The planning screen hardcodes `Is_Trip_Planning: true` and never exposes it,
  // so a user cannot work around it. Assert satisfiability, not spelling: pull
  // both `import_export IN (...)` lists out of the generated SQL, resolve their
  // placeholders back through the bound params, and require the intersection to
  // be non-empty.
  describe('move_type filter vs the Is_Trip_Planning whitelist', () => {
    /** Run the handler with `filters` and hand back the generated base SQL. */
    async function sqlFor(filters: Record<string, unknown>): Promise<string> {
      findUnique.mockResolvedValue({
        mssqlConnectionString: 'Server=a,1433',
        longhaulClient: 'nwi',
      })
      stubExecutor({ shipments: [] })
      const encoded = encodeURIComponent(JSON.stringify({ filters }))
      await buildApp().request(`/onprem/longhaul/shipments?filters=${encoded}`)
      const [, sql] = executeSqlMock.mock.calls[0] as [string, string, unknown]
      return sql
    }

    async function importExportSetsFor(filters: Record<string, unknown>) {
      findUnique.mockResolvedValue({
        mssqlConnectionString: 'Server=a,1433',
        longhaulClient: 'nwi',
      })
      stubExecutor({ shipments: [] })
      const encoded = encodeURIComponent(JSON.stringify({ filters }))
      await buildApp().request(`/onprem/longhaul/shipments?filters=${encoded}`)
      const [, sql, opts] = executeSqlMock.mock.calls[0] as [
        string,
        string,
        { params: Array<{ name: string; value: unknown }> },
      ]
      const byName = new Map(opts.params.map((p) => [p.name, p.value]))
      // Each `import_export IN (@p3, @p4)` clause → the set of values it admits.
      return [...sql.matchAll(/import_export IN \(([^)]*)\)/g)].map(
        (m) =>
          new Set(
            m[1]!
              .split(',')
              .map((ph) => byName.get(ph.trim().replace(/^@/, '')))
              .map(String),
          ),
      )
    }

    /**
     * Intersect every `import_export IN (...)` clause the query emits. The
     * conjunction can match a row iff this is non-empty — which is the property
     * that actually matters, and is independent of HOW the handler avoids the
     * clash (suppressing the whitelist, widening it, or anything else).
     */
    function admissible(sets: Array<Set<string>>): Set<string> {
      return sets.reduce((acc, s) => new Set([...acc].filter((v) => s.has(v))))
    }

    // Every code NWI's Move Types dropdown offers. NWI's `moveTypesWhere` is
    // '1=1', so the dropdown is the MoveType lookup in full — transcribed from
    // prod (tenant 9d869236-518f-4fe4-90d3-274a1b957c38). Only 6 of these were
    // in the eligibility whitelist; the other 10 were unsatisfiable and
    // returned zero rows for every date range, zone and tenant.
    const NWI_MOVE_TYPES = [
      ['A', 'AUTO ONLY'],
      ['C', 'COMM TRUCKLOAD'],
      ['DA', 'DEST SERVICE ONLY'],
      ['HA', 'HAULER ONLY'],
      ['H', 'HHG INTERSTATE'],
      ['I', 'HHG INTRASTATE'],
      ['Z', 'INTERNATIONAL'],
      ['LC', "LOCAL COMM'L"],
      ['L', 'LOCAL MOVES'],
      ['M', 'MILITARY'],
      ['OA', 'ORIGIN SERVICE ONLY'],
      ['OF', 'OVERFLOW'],
      ['P', 'PERM STORAGE'],
      ['SS', 'SMALL SHIPMENT'],
      ['SP', 'SPECIAL PRODUCTS'],
      ['TC', 'TIME CRITICAL'],
    ] as const

    it.each(NWI_MOVE_TYPES)(
      'leaves move type %s (%s) satisfiable against the trip-planning whitelist',
      async (value) => {
        const sets = await importExportSetsFor({
          Is_Trip_Planning: true,
          move_type: [{ value }],
        })

        // The selection must survive the conjunction — this is the assertion
        // that fails for all 10 non-whitelisted codes without the override.
        expect(admissible(sets)).toEqual(new Set([value]))
      },
    )

    it('still narrows to the selected move type rather than ignoring it', async () => {
      // The fix must not turn the filter into a no-op: picking one code must
      // still exclude every other, including whitelisted ones.
      const sets = await importExportSetsFor({
        Is_Trip_Planning: true,
        move_type: [{ value: 'Z' }],
      })

      expect(admissible(sets)).toEqual(new Set(['Z']))
    })

    it('returns every selected code when broken and working ones are mixed', async () => {
      // The quiet variant of the bug: multi-selecting a non-whitelisted code
      // alongside a whitelisted one did not return zero rows, it silently
      // dropped the former and returned an incomplete list.
      const sets = await importExportSetsFor({
        Is_Trip_Planning: true,
        move_type: [{ value: 'OA' }, { value: 'H' }],
      })

      expect(admissible(sets)).toEqual(new Set(['OA', 'H']))
    })

    it('keeps the whitelist alone when no move type is selected', async () => {
      const sets = await importExportSetsFor({ Is_Trip_Planning: true })

      // The default list is whitelist-gated exactly as before — the override
      // must not leak into the unfiltered case, which is what keeps the default
      // planning list at ~15.9k rather than ~43.6k eligible rows.
      expect(sets).toHaveLength(1)
      expect(sets[0]).toEqual(new Set(['H', 'HA', 'M', 'A', 'SS', 'Z']))
    })

    it('keeps the other eligibility predicates when a move type is selected', async () => {
      // Overriding the whitelist must not disarm the rest of Is_Trip_Planning:
      // asking for a move type says nothing about wanting inactive or
      // already-delivered shipments.
      const sql = await sqlFor({ Is_Trip_Planning: true, move_type: [{ value: 'OA' }] })

      expect(sql).toContain('shipment_status =')
      expect(sql).toContain('del_actual IS NULL')
    })
  })

  // One shipment must produce exactly one row. The planning list keys its
  // React rows by `shipment.order_num`, so a duplicate renders the same
  // shipment twice (and warns on the duplicate key). Two independent guards:
  // the base query can't fan out, and anything that slips through the view
  // itself is collapsed in JS.
  describe('duplicate rows', () => {
    async function baseSqlFor(filters: Record<string, unknown> = {}) {
      findUnique.mockResolvedValue({
        mssqlConnectionString: 'Server=a,1433',
        longhaulClient: 'nwi',
      })
      stubExecutor({ shipments: [] })
      const encoded = encodeURIComponent(JSON.stringify({ filters }))
      await buildApp().request(`/onprem/longhaul/shipments?filters=${encoded}`)
      return executeSqlMock.mock.calls[0]![1] as string
    }

    it('never joins a non-key table into the base query', async () => {
      const sql = await baseSqlFor({
        origin_zone: [{ value: 'NE' }],
        destination_zone: [{ value: 'SE' }],
      })

      // `sales` is 1:1 by contract only, and `geo_code` is not a key of
      // v_longhaul_states — a join on either multiplies the shipment row.
      expect(sql).not.toContain('LEFT JOIN sales')
      expect(sql).not.toContain('LEFT JOIN v_longhaul_states')
      expect(sql).not.toMatch(/JOIN\s+sales/)
    })

    it('reads the sales shadow columns through a TOP (1) OUTER APPLY', async () => {
      const sql = await baseSqlFor()

      expect(sql).toContain('OUTER APPLY')
      expect(sql).toContain('SELECT TOP (1)')
      expect(sql).toContain(
        'FROM sales AS sal WHERE sal.order_num = v_longhaul_shipments_v2.order_num',
      )
      // The aliased shadow columns the reshape layer depends on survive.
      expect(sql).toContain('ps.weight AS shadow_weight')
      expect(sql).toContain('ps.lng_dis_comments AS shadow_comments')
      expect(sql).toContain('ps.operations_name AS operations_name')
    })

    it('never re-projects a column `s.*` already carries', async () => {
      // Regression: the apply also selected `ps.operations_id AS operations_id`,
      // but the view already projects `sales.operations_id` — the very column
      // being re-read. Two output columns of the same name make the mssql
      // driver hand back an ARRAY for that key (prod order 489808 arrived as
      // `operations_id: [1196, 1196]`) instead of a scalar. Any shadow column
      // must be aliased to a name the view does not project.
      const sql = await baseSqlFor()

      expect(sql).not.toContain('ps.operations_id')
      // The shadow aliases that remain are all names the view has no column
      // for, so none of them can collide with `s.*`.
      const aliases = [...sql.matchAll(/ps\.\w+ AS (\w+)/g)].map((m) => m[1])
      expect(aliases).toEqual(['shadow_weight', 'shadow_comments', 'operations_name'])
      for (const alias of aliases) {
        expect(LONGHAUL_SHIPMENT_VIEW_COLUMNS).not.toContain(alias)
      }
    })

    it('collapses rows the view returns twice for one order_num', async () => {
      findUnique.mockResolvedValue({
        mssqlConnectionString: 'Server=a,1433',
        longhaulClient: 'nwi',
      })
      stubExecutor({
        shipments: [
          { order_num: 5001, shipper_name: 'DOE, JANE' },
          { order_num: 5001, shipper_name: 'DOE, JANE' },
          { order_num: 5002, shipper_name: 'ROE, RICHARD' },
        ],
      })

      const res = await buildApp().request('/onprem/longhaul/shipments')
      const body = (await res.json()) as {
        data: Array<{ order_num: number }>
        meta: { count: number }
      }

      expect(body.data.map((s) => s.order_num)).toEqual([5001, 5002])
      expect(body.meta.count).toBe(2)
    })

    it('keeps the first duplicate so the ORDER BY still decides list order', async () => {
      findUnique.mockResolvedValue({
        mssqlConnectionString: 'Server=a,1433',
        longhaulClient: 'nwi',
      })
      stubExecutor({
        shipments: [
          { order_num: 7001, shipper_name: 'FIRST' },
          { order_num: 7001, shipper_name: 'SECOND' },
        ],
      })

      const res = await buildApp().request('/onprem/longhaul/shipments')
      const body = (await res.json()) as { data: Array<{ shipper_name: string }> }

      expect(body.data).toHaveLength(1)
      expect(body.data[0]!.shipper_name).toBe('FIRST')
    })

    it('passes through rows with no order_num rather than collapsing them', async () => {
      findUnique.mockResolvedValue({
        mssqlConnectionString: 'Server=a,1433',
        longhaulClient: 'nwi',
      })
      stubExecutor({
        shipments: [
          { order_num: null, shipper_name: 'A' },
          { order_num: null, shipper_name: 'B' },
        ],
      })

      const res = await buildApp().request('/onprem/longhaul/shipments')
      const body = (await res.json()) as { data: unknown[]; meta: { count: number } }

      expect(body.meta.count).toBe(2)
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

  describe('the post-fetch latest_activity filter', () => {
    // `latest_activity_abbr` is derived in JS by enrichShipmentWithTripInfo, so
    // it has no column to put in a WHERE clause — the filter runs in the same
    // post-enrichment pass as TripStatus_id. These tests pin that placement:
    // every case drives the filter through the real enrichment, never by
    // pre-setting the field on the base row.
    function activity(orderNum: number, abbr: string | null, extra: Record<string, unknown> = {}) {
      return {
        __src: 'activity',
        __order_num: orderNum,
        __payload: payload({
          order_num: orderNum,
          actual_date: null,
          planned_start: '2026-01-01',
          activityType_abbreviation: abbr,
          ...extra,
        }),
      }
    }

    async function requestWithFilters(filters: Record<string, unknown>) {
      const encoded = encodeURIComponent(JSON.stringify({ filters }))
      const res = await buildApp().request(`/onprem/longhaul/shipments?filters=${encoded}`)
      return (await res.json()) as {
        data: Array<{ order_num: number }>
        meta: { count: number }
      }
    }

    beforeEach(() => {
      findUnique.mockResolvedValue({
        mssqlConnectionString: 'Server=a,1433',
        longhaulClient: 'nwi',
      })
    })

    it('keeps only shipments whose enriched latest_activity_abbr matches', async () => {
      stubExecutor({
        shipments: [{ order_num: 1 }, { order_num: 2 }, { order_num: 3 }],
        enrichment: [activity(1, 'SIT'), activity(2, 'PK'), activity(3, 'SIT')],
        extraLocations: [],
      })

      const body = await requestWithFilters({ latest_activity: [{ value: 'SIT' }] })

      expect(body.data.map((s) => s.order_num)).toEqual([1, 3])
      expect(body.meta.count).toBe(2)
    })

    it('ORs multiple selected activities together', async () => {
      stubExecutor({
        shipments: [{ order_num: 1 }, { order_num: 2 }, { order_num: 3 }],
        enrichment: [activity(1, 'SIT'), activity(2, 'PK'), activity(3, 'DEL')],
        extraLocations: [],
      })

      const body = await requestWithFilters({
        latest_activity: [{ value: 'SIT' }, { value: 'DEL' }],
      })

      expect(body.data.map((s) => s.order_num)).toEqual([1, 3])
    })

    it('leaves the list untouched when the filter is absent or empty', async () => {
      stubExecutor({
        shipments: [{ order_num: 1 }, { order_num: 2 }],
        enrichment: [activity(1, 'SIT'), activity(2, 'PK')],
        extraLocations: [],
      })

      expect((await requestWithFilters({})).data.map((s) => s.order_num)).toEqual([1, 2])
      expect(
        (await requestWithFilters({ latest_activity: [] })).data.map((s) => s.order_num),
      ).toEqual([1, 2])
    })

    // The legacy DB stores these as nvarchar and pads them inconsistently — the
    // same class of bug as the `import_export` move-type collision (#628), where
    // MSSQL's own `=` ignores trailing spaces but a JS comparison does not.
    it('matches a padded abbreviation against an unpadded selection', async () => {
      stubExecutor({
        shipments: [{ order_num: 1 }, { order_num: 2 }],
        enrichment: [activity(1, 'SIT '), activity(2, ' PK')],
        extraLocations: [],
      })

      const body = await requestWithFilters({
        latest_activity: [{ value: 'SIT' }, { value: 'PK ' }],
      })

      expect(body.data.map((s) => s.order_num)).toEqual([1, 2])
    })

    it('excludes shipments with no activity at all once the filter is set', async () => {
      stubExecutor({
        // order 2 gets no activity row, so getTripInfo yields {} and the
        // enriched abbr is null.
        shipments: [{ order_num: 1 }, { order_num: 2 }],
        enrichment: [activity(1, 'SIT')],
        extraLocations: [],
      })

      const body = await requestWithFilters({ latest_activity: [{ value: 'SIT' }] })

      expect(body.data.map((s) => s.order_num)).toEqual([1])
    })

    it('ANDs with the TripStatus_id filter', async () => {
      stubExecutor({
        shipments: [{ order_num: 1 }, { order_num: 2 }, { order_num: 3 }],
        enrichment: [
          activity(1, 'SIT', { trip_status_id: 3 }),
          activity(2, 'SIT', { trip_status_id: 9 }),
          activity(3, 'PK', { trip_status_id: 3 }),
        ],
        extraLocations: [],
      })

      const body = await requestWithFilters({
        latest_activity: [{ value: 'SIT' }],
        TripStatus_id: [{ value: 3 }],
      })

      expect(body.data.map((s) => s.order_num)).toEqual([1])
      expect(body.meta.count).toBe(1)
    })

    it('adds no predicate to the base SQL', async () => {
      stubExecutor({ shipments: [], enrichment: [], extraLocations: [] })

      await requestWithFilters({ latest_activity: [{ value: 'SIT' }] })

      const baseSql = executeSqlMock.mock.calls[0]![1] as string
      expect(baseSql).not.toContain('latest_activity')
    })
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

  describe('sit_dest filter', () => {
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

    it('matches orders with an ACTUAL SIT-In when set to Yes', async () => {
      const [, sql, opts] = await sqlForFilters({ sit_dest: [{ value: 'Yes', label: 'Yes' }] })

      expect(sql).toContain('EXISTS (')
      expect(sql).not.toContain('NOT EXISTS (')
      expect(sql).toContain('FROM LongDistanceDispatchActivity AS sit')
      expect(sql).toContain('sit.actual_date IS NOT NULL')
      // The whole point of the filter: the SIT-In that HAPPENED, not the one
      // that was scheduled. whse_date is the planned date and must not appear.
      expect(sql).not.toContain('whse_date')
      // Bound, not inlined.
      expect(sql).not.toContain("'SITIN'")
      expect(opts.params.map((p) => p.value)).toContain('SITIN')
    })

    it('matches orders WITHOUT an actual SIT-In when set to No', async () => {
      const [, sql, opts] = await sqlForFilters({ sit_dest: [{ value: 'No', label: 'No' }] })

      expect(sql).toContain('NOT EXISTS (')
      expect(sql).toContain('sit.actual_date IS NOT NULL')
      expect(opts.params.map((p) => p.value)).toContain('SITIN')
    })

    it('correlates the subquery to the outer shipment row', async () => {
      // Without the order_num correlation this is "does ANY order have a SIT-In",
      // which is either all rows or none.
      const [, sql] = await sqlForFilters({ sit_dest: [{ value: 'Yes', label: 'Yes' }] })
      expect(sql).toMatch(/WHERE sit\.order_num = \w+\.order_num/)
    })

    it('adds no predicate when the selection is empty', async () => {
      const [, sql] = await sqlForFilters({ sit_dest: [] })
      expect(sql).not.toContain('LongDistanceDispatchActivity AS sit')
    })

    it('adds no predicate for a value that is neither Yes nor No', async () => {
      // Fail open rather than emit a half-built clause: a saved filter from an
      // older panel build, or a hand-edited query string, must not change which
      // orders come back.
      const [, sql] = await sqlForFilters({ sit_dest: [{ value: 'Maybe', label: 'Maybe' }] })
      expect(sql).not.toContain('LongDistanceDispatchActivity AS sit')
    })

    it('adds no predicate when the selected option carries no value', async () => {
      const [, sql] = await sqlForFilters({ sit_dest: [{ label: 'Yes' }] })
      expect(sql).not.toContain('LongDistanceDispatchActivity AS sit')
    })

    it('adds no predicate when both Yes and No are selected', async () => {
      // Yes OR No is every order, so the `length === 1` guard drops it rather
      // than emitting a contradictory pair of clauses.
      const [, sql] = await sqlForFilters({
        sit_dest: [
          { value: 'Yes', label: 'Yes' },
          { value: 'No', label: 'No' },
        ],
      })
      expect(sql).not.toContain('LongDistanceDispatchActivity AS sit')
    })
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
