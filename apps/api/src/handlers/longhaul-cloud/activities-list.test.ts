// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct longhaul GET /activities (LIST) handler.
//
// Prisma and the mssql-executor client are mocked, so nothing here touches
// Postgres or the executor Lambda. Assertions are on the SQL text and the bound
// parameters the handler hands the executor — that IS the contract, since every
// filter this board offers is applied in SQL rather than post-fetch.
//
// The two structural guards worth naming, because both are regressions this
// repo has already paid for once:
//   - no bare `a.*` / `s.*` in the projection (#575 — a duplicated output
//     column name makes the mssql driver return an array for that key);
//   - no `FOR JSON` (#629/#634 — it silently omits NULL-valued keys).
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

import { longhaulActivitiesListHandler } from './activities-list'
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
  app.get('/onprem/longhaul/activities', longhaulActivitiesListHandler)
  return app
}

/** Configure a tenant that has a legacy DB, and an executor that returns `rows`. */
function withRows(rows: unknown[]) {
  findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
  executeSqlMock.mockResolvedValue({ recordset: rows, rowsAffected: [] })
}

/** `res.json()` is typed `unknown`; these assertions read one known key each. */
interface ErrorBody {
  code?: string
  error?: string
}
interface ListBody {
  data?: unknown[]
  meta?: { count?: number }
}

async function body(res: Response): Promise<ErrorBody & ListBody> {
  return (await res.json()) as ErrorBody & ListBody
}

/** The SQL string the handler passed to the executor on its single call. */
function sentSql(): string {
  return executeSqlMock.mock.calls[0]?.[1] as string
}

/** The bound parameters the handler passed alongside it. */
function sentParams(): Array<{ name: string; value: unknown }> {
  return (executeSqlMock.mock.calls[0]?.[2]?.params ?? []) as Array<{
    name: string
    value: unknown
  }>
}

/** Encode a filter object the way the client puts it on the query string. */
function filtersQs(filters: unknown, extra: Record<string, unknown> = {}): string {
  return `?filters=${encodeURIComponent(JSON.stringify({ filters, ...extra }))}`
}

describe('GET longhaul/activities (cloud-direct LIST)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('response envelope', () => {
    it('returns the activity rows in { data, meta } shape', async () => {
      withRows([
        { id: 1, order_num: 5001, activity_type_abbreviation: 'PACK' },
        { id: 2, order_num: 5002, activity_type_abbreviation: 'LOAD' },
      ])

      const res = await buildApp().request('/onprem/longhaul/activities')

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        data: [
          { id: 1, order_num: 5001, activity_type_abbreviation: 'PACK' },
          { id: 2, order_num: 5002, activity_type_abbreviation: 'LOAD' },
        ],
        meta: { count: 2 },
      })
    })

    it('makes exactly one round trip', async () => {
      withRows([])

      await buildApp().request('/onprem/longhaul/activities')

      expect(executeSqlMock).toHaveBeenCalledTimes(1)
    })

    it('422s when the tenant has no legacy database configured', async () => {
      findUnique.mockResolvedValue({ mssqlConnectionString: null })

      const res = await buildApp().request('/onprem/longhaul/activities')

      expect(res.status).toBe(422)
      expect((await body(res)).code).toBe('MSSQL_NOT_CONFIGURED')
      expect(executeSqlMock).not.toHaveBeenCalled()
    })

    it('does NOT require a longhaulClient — nothing in the query is per-client', async () => {
      findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433', longhaulClient: null })
      executeSqlMock.mockResolvedValue({ recordset: [], rowsAffected: [] })

      const res = await buildApp().request('/onprem/longhaul/activities')

      expect(res.status).toBe(200)
    })

    it('400s on malformed filters JSON', async () => {
      withRows([])

      const res = await buildApp().request('/onprem/longhaul/activities?filters=not-json')

      expect(res.status).toBe(400)
      expect((await body(res)).code).toBe('VALIDATION_ERROR')
      expect(executeSqlMock).not.toHaveBeenCalled()
    })

    it('500s when the executor throws', async () => {
      findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
      executeSqlMock.mockRejectedValue(new Error('connect ETIMEDOUT'))

      const res = await buildApp().request('/onprem/longhaul/activities')

      expect(res.status).toBe(500)
      expect((await body(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  describe('result cap', () => {
    it('400s RESULT_LIMIT_EXCEEDED past 1000 rows rather than truncating', async () => {
      withRows(Array.from({ length: 1001 }, (_, i) => ({ id: i })))

      const res = await buildApp().request('/onprem/longhaul/activities')

      expect(res.status).toBe(400)
      expect((await body(res)).code).toBe('RESULT_LIMIT_EXCEEDED')
    })

    it('returns exactly 1000 rows without complaint', async () => {
      withRows(Array.from({ length: 1000 }, (_, i) => ({ id: i })))

      const res = await buildApp().request('/onprem/longhaul/activities')

      expect(res.status).toBe(200)
      expect((await body(res)).meta?.count).toBe(1000)
    })

    it('caps the query itself at limit+1 so a runaway never leaves the database', async () => {
      withRows([])

      await buildApp().request('/onprem/longhaul/activities')

      expect(sentSql()).toContain('SELECT TOP (1001)')
    })
  })

  describe('projection', () => {
    it('never selects a bare wildcard — a duplicated output name returns an array (#575)', async () => {
      withRows([])

      await buildApp().request('/onprem/longhaul/activities')

      expect(sentSql()).not.toMatch(/\ba\.\*/)
      expect(sentSql()).not.toMatch(/\bs\.\*/)
    })

    it('uses a plain SELECT — FOR JSON would omit NULL-valued keys (#629)', async () => {
      withRows([])

      await buildApp().request('/onprem/longhaul/activities')

      expect(sentSql()).not.toContain('FOR JSON')
    })

    it('aliases every shipment column away from its source name', async () => {
      withRows([])

      await buildApp().request('/onprem/longhaul/activities')

      // The activity's own `state` is its address; the shipment's must not
      // land on the same output key.
      expect(sentSql()).toContain('a.state')
      expect(sentSql()).toContain('s.consignee_state AS destination_state')
      expect(sentSql()).not.toMatch(/s\.consignee_state(?! AS)/)
    })

    it('joins the type catalog, the driver, and the shipments view', async () => {
      withRows([])

      await buildApp().request('/onprem/longhaul/activities')

      const sql = sentSql()
      expect(sql).toContain('FROM LongDistanceDispatchActivity AS a')
      expect(sql).toContain(
        'LEFT JOIN Longhaul_ActivityType AS at ON a.ActivityType_code = at.code',
      )
      expect(sql).toContain('LEFT JOIN v_longhaul_drivers AS drv')
      expect(sql).toContain('LEFT JOIN v_longhaul_shipments_v2 AS s ON a.order_num = s.order_num')
    })
  })

  describe('filters', () => {
    it('applies no WHERE clause when nothing is filtered', async () => {
      withRows([])

      await buildApp().request('/onprem/longhaul/activities')

      expect(sentSql()).not.toContain('WHERE')
      expect(sentParams()).toEqual([])
    })

    it('bounds the date range on estimated_date, inclusive at both ends', async () => {
      withRows([])

      await buildApp().request(
        '/onprem/longhaul/activities' + filtersQs({ date_range: ['2026-09-10', '2026-09-17'] }),
      )

      expect(sentSql()).toContain('a.estimated_date >= @p0')
      expect(sentParams()).toEqual([
        { name: 'p0', value: '2026-09-10' },
        { name: 'p1', value: '2026-09-17' },
      ])
    })

    it('includes the whole last day, not just its midnight', async () => {
      withRows([])

      await buildApp().request(
        '/onprem/longhaul/activities' + filtersQs({ date_range: [null, '2026-09-17'] }),
      )

      // The column is a DATETIME holding a calendar day. Rows written before the
      // #534 normalization carry times like `05:00:00`, and `<= '2026-09-17'`
      // compares against that day's midnight — dropping every one of them from
      // a board whose entire job is "show me this date".
      expect(sentSql()).toContain('a.estimated_date < DATEADD(day, 1, @p0)')
      expect(sentSql()).not.toMatch(/estimated_date <= /)
    })

    it('does NOT test overlap against planned_start/planned_end', async () => {
      withRows([])

      await buildApp().request(
        '/onprem/longhaul/activities' + filtersQs({ date_range: ['2026-09-10', '2026-09-17'] }),
      )

      // `planned_end < planned_start` is legitimate on this data (#619/#622), so
      // an overlap predicate would silently drop the inverted spans.
      expect(sentSql()).not.toMatch(/WHERE[\s\S]*planned_start/)
      expect(sentSql()).not.toMatch(/WHERE[\s\S]*planned_end/)
    })

    it('accepts an open-ended range from one side only', async () => {
      withRows([])

      await buildApp().request(
        '/onprem/longhaul/activities' + filtersQs({ date_range: ['2026-09-10', null] }),
      )

      expect(sentSql()).toContain('a.estimated_date >= @p0')
      expect(sentSql()).not.toContain('a.estimated_date <=')
      expect(sentParams()).toEqual([{ name: 'p0', value: '2026-09-10' }])
    })

    it('filters activity type on the ABBREVIATION the client actually sends', async () => {
      withRows([])

      await buildApp().request(
        '/onprem/longhaul/activities' +
          filtersQs({ activity_type: [{ value: 'PACK' }, { value: 'LOAD' }] }),
      )

      // `filterOptions.activityType` (reference-data.ts → toActivityTypeOptions)
      // emits `{ value: <abbreviation> }`. Matching `ActivityType_code` here
      // would return zero rows for every type whose code differs from its
      // abbreviation — a filter that looks like it works and finds nothing.
      expect(sentSql()).toContain('at.abbreviation IN (@p0, @p1)')
      expect(sentSql()).not.toContain('a.ActivityType_code IN')
      expect(sentParams().map((p) => p.value)).toEqual(['PACK', 'LOAD'])
    })

    it('filters short haul on the shipment haul_mode reached through the join', async () => {
      withRows([])

      await buildApp().request(
        '/onprem/longhaul/activities' + filtersQs({ short_haul: [{ value: 'Y' }] }),
      )

      expect(sentSql()).toContain('s.haul_mode IN (@p0)')
      expect(sentParams()).toEqual([{ name: 'p0', value: 'Y' }])
    })

    it('filters dispatcher on the shipment operations_id', async () => {
      withRows([])

      await buildApp().request(
        '/onprem/longhaul/activities' + filtersQs({ operations_id: [{ value: '1196' }] }),
      )

      expect(sentSql()).toContain('s.operations_id IN (@p0)')
      expect(sentParams()).toEqual([{ name: 'p0', value: '1196' }])
    })

    it('ANDs every filter together and binds each value', async () => {
      withRows([])

      await buildApp().request(
        '/onprem/longhaul/activities' +
          filtersQs({
            date_range: ['2026-09-10', '2026-09-17'],
            activity_type: [{ value: 'PACK' }],
            short_haul: [{ value: 'N' }],
            operations_id: [{ value: '1196' }],
          }),
      )

      const sql = sentSql()
      // 5 predicates (2 date bounds + 3 filters) => 4 ANDs joining them. The
      // DATEADD in the upper bound contributes no extra AND.
      expect(sql.match(/ AND /g)).toHaveLength(4)
      expect(sentParams()).toHaveLength(5)
      // No filter value is ever inlined into the SQL text.
      expect(sql).not.toContain('2026-09-10')
      expect(sql).not.toContain('PACK')
    })

    it('ignores an empty selection rather than emitting an empty IN ()', async () => {
      withRows([])

      await buildApp().request(
        '/onprem/longhaul/activities' + filtersQs({ activity_type: [], short_haul: [] }),
      )

      expect(sentSql()).not.toContain('WHERE')
    })

    it('sends nothing for office — there is no such dimension in the schema', async () => {
      withRows([])

      await buildApp().request(
        '/onprem/longhaul/activities' + filtersQs({ office: [{ value: 'chicago' }] }),
      )

      expect(sentSql()).not.toContain('WHERE')
      expect(sentSql()).not.toContain('office')
    })
  })

  describe('sorting', () => {
    it('defaults to soonest-first with a deterministic tiebreak', async () => {
      withRows([])

      await buildApp().request('/onprem/longhaul/activities')

      expect(sentSql()).toContain('ORDER BY a.estimated_date ASC, a.id ASC')
    })

    it('honors a whitelisted sort column and direction', async () => {
      withRows([])

      await buildApp().request(
        '/onprem/longhaul/activities' +
          filtersQs({}, { sortBy: { value: 'order_num', order: 'desc' } }),
      )

      expect(sentSql()).toContain('ORDER BY a.order_num DESC, a.id ASC')
    })

    it('falls back to the default ordering for a column not on the whitelist', async () => {
      withRows([])

      await buildApp().request(
        '/onprem/longhaul/activities' +
          filtersQs({}, { sortBy: { value: 'a.id; DROP TABLE TripMaster--', order: 'asc' } }),
      )

      expect(sentSql()).toContain('ORDER BY a.estimated_date ASC, a.id ASC')
      expect(sentSql()).not.toContain('DROP TABLE')
    })
  })
})
