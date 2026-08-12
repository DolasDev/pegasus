// ---------------------------------------------------------------------------
// Unit tests for the reporting handlers.
//
// Prisma, the mssql-executor client and the Cedar/AVP permission lookup are all
// mocked, so these run without Postgres, the executor Lambda, or the tunnel.
// Mirrors dashboard-pegii.test.ts.
//
// The behaviors worth pinning here are the ones a dashboard depends on:
//   - the two authorization gates, and that the second fails CLOSED;
//   - one tunnel round trip regardless of legacy widget count;
//   - per-slot degradation, so one dead source cannot blank a dashboard;
//   - response order always mirrors request order.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'

vi.mock('../lib/mssql-executor-client', () => ({
  executeSql: vi.fn(),
}))
vi.mock('../lib/authz', () => ({
  listAllowedPermissions: vi.fn(),
}))
// The route-level Cedar gate is exercised by middleware/rbac.test.ts; here it
// is a pass-through so these tests isolate the handler's own logic.
vi.mock('../middleware/rbac', () => ({
  requirePermission: () => async (_c: unknown, next: () => Promise<void>) => {
    await next()
  },
}))

import { reportingHandler, MAX_BATCH } from './reporting'
import { executeSql } from '../lib/mssql-executor-client'
import { listAllowedPermissions } from '../lib/authz'

/** The tenant lookup goes through the request-scoped client (db-access-guard). */
const findUnique = vi.fn()
const executeSqlMock = executeSql as unknown as Mock
const permissionsMock = listAllowedPermissions as unknown as Mock

const ALL_PERMS = ['move:list', 'invoice:read', 'quote:read', 'report:read']

function buildApp() {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    c.set('principal', { sub: 'user-1', tenantId: 'tenant-1', roleNames: ['viewer'] })
    c.set('db', makeDb() as never)
    await next()
  })
  app.route('/reporting', reportingHandler)
  return app
}

/** Minimal Prisma stand-in covering the delegates the seed datasets touch. */
function makeDb() {
  return {
    move: {
      groupBy: vi.fn().mockResolvedValue([
        { status: 'PENDING', _count: { _all: 3 } },
        { status: 'COMPLETED', _count: { _all: 7 } },
      ]),
    },
    quote: { groupBy: vi.fn().mockResolvedValue([{ status: 'SENT', _count: { _all: 4 } }]) },
    invoice: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: 1500.5 }, _count: { _all: 2 } }),
    },
    tenant: { findUnique: findUnique },
  }
}

function post(app: Hono<AppEnv>, body: unknown) {
  return app.request('/reporting/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Response bodies are `unknown` from `res.json()`; these describe what we assert on. */
interface ErrorBody {
  error: string
  code: string
}
interface CatalogBody {
  data: { datasets: { id: string; paramsSchema?: unknown }[] }
}
interface QueryBody {
  data: {
    results: {
      datasetId: string
      rows?: Record<string, unknown>[]
      error?: { message: string; code: string }
    }[]
  }
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env['REPORTING_ENABLED'] = 'true'
  permissionsMock.mockResolvedValue(ALL_PERMS)
})

afterEach(() => {
  delete process.env['REPORTING_ENABLED']
})

// ---------------------------------------------------------------------------

describe('reporting — feature gate', () => {
  it('404s the whole surface when REPORTING_ENABLED is not "true"', async () => {
    delete process.env['REPORTING_ENABLED']
    const res = await buildApp().request('/reporting/datasets')
    expect(res.status).toBe(404)
    expect((await json<ErrorBody>(res)).code).toBe('NOT_FOUND')
  })
})

describe('GET /reporting/datasets', () => {
  it('returns only the datasets the caller may run', async () => {
    permissionsMock.mockResolvedValue(['invoice:read', 'report:read'])

    const res = await buildApp().request('/reporting/datasets')
    const body = await json<CatalogBody>(res)

    expect(res.status).toBe(200)
    const ids = body.data.datasets.map((d) => d.id)
    expect(ids).toEqual(['invoices-outstanding', 'longhaul-invoiced-ytd'])
  })

  it('returns an empty catalog — not a 403 — when no dataset grants are held', async () => {
    // The caller holds the reporting surface permission but no data grants.
    // An empty list is the correct answer; a 403 would be a lie.
    permissionsMock.mockResolvedValue(['report:read'])

    const res = await buildApp().request('/reporting/datasets')

    expect(res.status).toBe(200)
    expect((await json<CatalogBody>(res)).data.datasets).toEqual([])
  })
})

describe('POST /reporting/query — validation', () => {
  it('rejects an unknown dataset id', async () => {
    const res = await post(buildApp(), { requests: [{ datasetId: 'nope' }] })
    expect(res.status).toBe(400)
    expect((await json<ErrorBody>(res)).code).toBe('UNKNOWN_DATASET')
  })

  it(`rejects a batch larger than ${MAX_BATCH}`, async () => {
    const requests = Array.from({ length: MAX_BATCH + 1 }, () => ({
      datasetId: 'moves-by-status',
    }))
    const res = await post(buildApp(), { requests })
    expect(res.status).toBe(400)
    expect((await json<ErrorBody>(res)).code).toBe('INVALID_BODY')
  })

  it('rejects params that fail the dataset’s own schema', async () => {
    const res = await post(buildApp(), {
      requests: [{ datasetId: 'moves-by-status', params: { window: 'forever' } }],
    })
    expect(res.status).toBe(400)
    expect((await json<ErrorBody>(res)).code).toBe('INVALID_PARAMS')
  })

  it('rejects a malformed JSON body', async () => {
    const res = await buildApp().request('/reporting/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /reporting/query — authorization', () => {
  it('treats a request with no principal as holding nothing', async () => {
    // Defensive: the route middleware should already have refused, so this is
    // the belt to that braces — it must fail closed, never open.
    const app = new Hono<AppEnv>()
    registerTestErrorHandler(app)
    app.use('*', async (c, next) => {
      c.set('tenantId', 'tenant-1')
      c.set('correlationId', 'corr-1')
      c.set('db', makeDb() as never)
      await next()
    })
    app.route('/reporting', reportingHandler)

    const res = await post(app, { requests: [{ datasetId: 'moves-by-status' }] })
    expect(res.status).toBe(403)
    expect(permissionsMock).not.toHaveBeenCalled()
  })

  it('fails the WHOLE request closed when any dataset is not permitted', async () => {
    // Partial results would leak which datasets exist and which are withheld.
    permissionsMock.mockResolvedValue(['move:list', 'report:read'])

    const res = await post(buildApp(), {
      requests: [{ datasetId: 'moves-by-status' }, { datasetId: 'invoices-outstanding' }],
    })

    expect(res.status).toBe(403)
    expect((await json<ErrorBody>(res)).code).toBe('FORBIDDEN')
  })
})

describe('POST /reporting/query — postgres datasets', () => {
  it('runs a dataset and returns mapped rows', async () => {
    const res = await post(buildApp(), { requests: [{ datasetId: 'moves-by-status' }] })
    const body = await json<QueryBody>(res)

    expect(res.status).toBe(200)
    expect(body.data.results).toEqual([
      {
        datasetId: 'moves-by-status',
        rows: [
          { status: 'COMPLETED', count: 7 },
          { status: 'PENDING', count: 3 },
        ],
      },
    ])
  })

  it('degrades only its own slot when a postgres dataset throws', async () => {
    const app = new Hono<AppEnv>()
    registerTestErrorHandler(app)
    app.use('*', async (c, next) => {
      c.set('tenantId', 'tenant-1')
      c.set('correlationId', 'corr-1')
      c.set('principal', { sub: 'user-1', tenantId: 'tenant-1', roleNames: ['viewer'] })
      const broken = makeDb()
      broken.move.groupBy = vi.fn().mockRejectedValue(new Error('deadlock'))
      c.set('db', broken as never)
      await next()
    })
    app.route('/reporting', reportingHandler)

    const res = await post(app, {
      requests: [{ datasetId: 'moves-by-status' }, { datasetId: 'invoices-outstanding' }],
    })
    const body = await json<QueryBody>(res)

    expect(res.status).toBe(200)
    expect(body.data.results[0]!.error!.code).toBe('DATASET_ERROR')
    // The healthy dataset in the same batch is unaffected.
    expect(body.data.results[1]!.rows).toEqual([{ amount: 1500.5, count: 2 }])
  })

  it('fills every funnel stage, including zeros, for the quote pipeline', async () => {
    // A missing bar reads as "no data"; a zero bar correctly reads as
    // "nothing converted".
    const res = await post(buildApp(), { requests: [{ datasetId: 'quotes-conversion-30d' }] })
    const body = await json<QueryBody>(res)

    expect(body.data.results[0]!.rows).toEqual([
      { status: 'DRAFT', count: 0 },
      { status: 'SENT', count: 4 },
      { status: 'ACCEPTED', count: 0 },
      { status: 'REJECTED', count: 0 },
      { status: 'EXPIRED', count: 0 },
    ])
  })

  it('reports zero rather than null when no invoices are outstanding', async () => {
    const app = new Hono<AppEnv>()
    registerTestErrorHandler(app)
    app.use('*', async (c, next) => {
      c.set('tenantId', 'tenant-1')
      c.set('correlationId', 'corr-1')
      c.set('principal', { sub: 'user-1', tenantId: 'tenant-1', roleNames: ['viewer'] })
      const empty = makeDb()
      // Prisma returns a null _sum when no rows match the filter.
      empty.invoice.aggregate = vi
        .fn()
        .mockResolvedValue({ _sum: { totalAmount: null }, _count: { _all: 0 } })
      c.set('db', empty as never)
      await next()
    })
    app.route('/reporting', reportingHandler)

    const res = await post(app, { requests: [{ datasetId: 'invoices-outstanding' }] })
    const body = await json<QueryBody>(res)

    expect(body.data.results[0]!.rows).toEqual([{ amount: 0, count: 0 }])
  })

  it('never reaches the tunnel when no legacy dataset is requested', async () => {
    await post(buildApp(), { requests: [{ datasetId: 'moves-by-status' }] })
    expect(executeSqlMock).not.toHaveBeenCalled()
    expect(findUnique).not.toHaveBeenCalled()
  })
})

describe('POST /reporting/query — legacy batching', () => {
  it('issues ONE executeSql call for multiple legacy datasets', async () => {
    // This is the Lambda-concurrency mitigation: widget count must not
    // multiply tunnel round trips.
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValue({
      recordset: [],
      recordsets: [
        [{ move_count: 5, movetype: 'I', move_desc: 'Import' }],
        [{ move_count: 2, movetype: 'E', move_desc: 'Export' }],
        [{ TotalInvoicesYTD: 987.65 }],
      ],
      rowsAffected: [],
    })

    const res = await post(buildApp(), {
      requests: [
        { datasetId: 'longhaul-new-orders-ytd' },
        { datasetId: 'longhaul-in-transit' },
        { datasetId: 'longhaul-invoiced-ytd' },
      ],
    })

    expect(executeSqlMock).toHaveBeenCalledTimes(1)
    const [, sql] = executeSqlMock.mock.calls[0]!
    expect(sql).toBe(
      'SELECT move_count, movetype, move_desc FROM v_dashboard1;' +
        'SELECT move_count, movetype, move_desc FROM v_dashboard2;' +
        'SELECT TotalInvoicesYTD FROM v_dashboard3',
    )

    const body = await json<QueryBody>(res)
    expect(body.data.results[0]!.rows).toEqual([{ moveType: 'I', description: 'Import', count: 5 }])
    expect(body.data.results[2]!.rows).toEqual([{ amount: 987.65 }])
  })

  it('degrades only the legacy slots when the tenant has no legacy DB', async () => {
    // A GLOBAL dashboard forked by a tenant with no on-prem DB must still
    // render its Postgres widgets (phase-2 portability depends on this).
    findUnique.mockResolvedValue({ mssqlConnectionString: null })

    const res = await post(buildApp(), {
      requests: [{ datasetId: 'moves-by-status' }, { datasetId: 'longhaul-in-transit' }],
    })
    const body = await json<QueryBody>(res)

    expect(res.status).toBe(200)
    expect(body.data.results[0]!.rows).toHaveLength(2)
    expect(body.data.results[1]!.error!.code).toBe('MSSQL_NOT_CONFIGURED')
    expect(body.data.results[1]!.rows).toBeUndefined()
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('degrades only the legacy slots when the batch throws', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockRejectedValue(new Error('tunnel down'))

    const res = await post(buildApp(), {
      requests: [{ datasetId: 'moves-by-status' }, { datasetId: 'longhaul-in-transit' }],
    })
    const body = await json<QueryBody>(res)

    expect(res.status).toBe(200)
    expect(body.data.results[0]!.rows).toHaveLength(2)
    expect(body.data.results[1]!.error!.code).toBe('DATASET_ERROR')
  })
})

describe('POST /reporting/query — result ordering', () => {
  it('mirrors request order even when sources are interleaved', async () => {
    // Slots are pre-allocated precisely so a slow legacy batch cannot reorder
    // the response relative to what the dashboard asked for.
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValue({
      recordset: [],
      recordsets: [[{ TotalInvoicesYTD: 1 }], [{ move_count: 1, movetype: 'X', move_desc: 'D' }]],
      rowsAffected: [],
    })

    const res = await post(buildApp(), {
      requests: [
        { datasetId: 'longhaul-invoiced-ytd' },
        { datasetId: 'moves-by-status' },
        { datasetId: 'longhaul-in-transit' },
        { datasetId: 'invoices-outstanding' },
      ],
    })
    const body = await json<QueryBody>(res)

    expect(body.data.results.map((r) => r.datasetId)).toEqual([
      'longhaul-invoiced-ytd',
      'moves-by-status',
      'longhaul-in-transit',
      'invoices-outstanding',
    ])
    // ...and each legacy slot got ITS OWN recordset, by fragment position.
    expect(body.data.results[0]!.rows).toEqual([{ amount: 1 }])
    expect(body.data.results[2]!.rows).toEqual([{ moveType: 'X', description: 'D', count: 1 }])
  })
})
