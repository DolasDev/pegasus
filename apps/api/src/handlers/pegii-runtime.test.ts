// ---------------------------------------------------------------------------
// Unit tests for the pegII-runtime handler (workflow-runtime order + task reads).
//
// dualAuthMiddleware is stubbed to inject the AppEnv context; requirePermission
// is NOT mocked — real Cedar RBAC runs against workflow-runtime.cedar, so these
// tests double as verification that ReadOrder / ReadSalesman / ReadTask /
// CloseTask are granted to workflow_runtime and withheld from workflow_developer.
//
// Single-order reads go through the OrderGateway, so order-gateway.factory is
// mocked to a controllable stub (its own resolution + tunnel transport are
// covered in the gateway/factory unit tests). Task routes stay on the
// in-memory pegII stub (services/pegii-tasks), reset between cases.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { _clearAuthzCache } from '../lib/authz'
import { _resetTaskStore } from '../services/pegii-tasks'
import type { OrderRecord } from '../services/pegii-orders'
import type { SalesmanRecord } from '../services/pegii-salesmen'

vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

const { findOrderById, findOrderNativeById, checkReachable, updateOrderNative, searchOrders } =
  vi.hoisted(() => ({
    updateOrderNative: vi.fn(),
    findOrderById: vi.fn(),
    findOrderNativeById: vi.fn(),
    checkReachable: vi.fn(),
    searchOrders: vi.fn(),
  }))
vi.mock('../gateways/order-gateway.factory', () => ({
  resolveOrderGateway: vi.fn(async () => ({
    findOrderById,
    findOrderNativeById,
    checkReachable,
    updateOrderNative,
    searchOrders,
  })),
}))

const { findSalesmanById, listSalesmen } = vi.hoisted(() => ({
  findSalesmanById: vi.fn(),
  listSalesmen: vi.fn(),
}))
vi.mock('../gateways/salesman-gateway.factory', () => ({
  resolveSalesmanGateway: vi.fn(async () => ({
    findSalesmanById,
    listSalesmen,
  })),
}))

import { pegiiRuntimeHandler } from './pegii-runtime'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { resolveOrderGateway } from '../gateways/order-gateway.factory'
import { resolveSalesmanGateway } from '../gateways/salesman-gateway.factory'
import { PegiiApiError } from '../lib/pegii-api-client'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

function buildApp(roleNames: readonly string[] = ['workflow_runtime']) {
  const fakeDb = {} as unknown as PrismaClient
  const tenantId = 'test-tenant-id'
  vi.mocked(dualAuthMiddleware).mockImplementation(async (c, next) => {
    c.set('tenantId', tenantId)
    c.set('principal', { sub: 'test-sub', tenantId, roleNames: [...roleNames] })
    c.set('idToken', undefined)
    c.set('policyStoreId', undefined)
    c.set('db', fakeDb)
    c.set('userId', 'svc-user-1')
    await next()
  })
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.route('/pegii', pegiiRuntimeHandler)
  return app
}

const orderRecord = (over: Partial<OrderRecord> = {}): OrderRecord => ({
  id: 'ord-1',
  orderNumber: 'SO-ord-1',
  status: 'booked',
  customerName: null,
  scheduledDate: null,
  packingActualDate: null,
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
  ...over,
})

const salesmanRecord = (over: Partial<SalesmanRecord> = {}): SalesmanRecord => ({
  id: 'sm-1',
  avlCode: null,
  firstName: null,
  lastName: null,
  name: 'sm-1',
  title: null,
  email: null,
  extension: null,
  branch: null,
  agencyCode: null,
  roles: null,
  employeeType: null,
  active: true,
  startDate: null,
  dateTerminated: null,
  winUsername: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  _clearAuthzCache()
  _resetTaskStore()
  // Default: source reachable. Individual cases override to simulate a down source.
  checkReachable.mockResolvedValue(undefined)
})

describe('GET /pegii/orders/:orderId', () => {
  it('returns the gateway-fetched order for workflow_runtime', async () => {
    findOrderById.mockResolvedValue(orderRecord({ id: 'ord-1', status: 'in_progress' }))
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/orders/ord-1')
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({ id: 'ord-1', status: 'in_progress' })
    expect(findOrderById).toHaveBeenCalledWith('ord-1')
  })

  it('returns 404 when the gateway reports no such order', async () => {
    findOrderById.mockResolvedValue(null)
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/orders/ord-missing')
    expect(res.status).toBe(404)
    expect((await json(res))['code']).toBe('NOT_FOUND')
  })

  it('rejects a role without ReadOrder (workflow_developer) with 403', async () => {
    const app = buildApp(['workflow_developer'])
    const res = await app.request('/pegii/orders/ord-1')
    expect(res.status).toBe(403)
    expect(findOrderById).not.toHaveBeenCalled()
  })

  it('returns the RAW native payload for ?shape=native', async () => {
    const native = { Id: '490574', Survey: { SerivceStatus: 'Accepted' }, WarehouseSummary: {} }
    findOrderNativeById.mockResolvedValue(native)
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/orders/490574?shape=native')
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toEqual(native)
    expect(findOrderNativeById).toHaveBeenCalledWith('490574')
    expect(findOrderById).not.toHaveBeenCalled()
  })

  it('returns 404 for ?shape=native when the order is missing', async () => {
    findOrderNativeById.mockResolvedValue(null)
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/orders/ord-missing?shape=native')
    expect(res.status).toBe(404)
    expect((await json(res))['code']).toBe('NOT_FOUND')
  })

  it('rejects an unknown shape value with 400', async () => {
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/orders/490574?shape=raw')
    expect(res.status).toBe(400)
    expect((await json(res))['code']).toBe('INVALID_SHAPE')
    expect(findOrderById).not.toHaveBeenCalled()
    expect(findOrderNativeById).not.toHaveBeenCalled()
  })

  it('returns 502 (not a bare 500) when the pegII source is unreachable', async () => {
    findOrderById.mockRejectedValue(
      new PegiiApiError('PEGII_API_TUNNEL_ERROR', 'PROXY_INVOKE_FAILED: connect timed out'),
    )
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/orders/483883')
    expect(res.status).toBe(502)
    const body = await json(res)
    expect(body['code']).toBe('PEGII_SOURCE_UNREACHABLE')
    expect(String(body['error'])).toMatch(/pegII source unreachable/)
    expect(body['correlationId']).toBeDefined()
  })

  it('returns 503 when the tenant has no configured pegII source', async () => {
    vi.mocked(resolveOrderGateway).mockRejectedValueOnce(
      new PegiiApiError('PEGII_API_NOT_CONFIGURED', 'tenant has no reachable pegII order source'),
    )
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/orders/483883')
    expect(res.status).toBe(503)
    expect((await json(res))['code']).toBe('PEGII_SOURCE_UNAVAILABLE')
  })

  it('returns 502 when the pegII source answers with a bad envelope', async () => {
    findOrderById.mockRejectedValue(
      new PegiiApiError('PEGII_API_BAD_ENVELOPE', 'missing the `data` field', 200),
    )
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/orders/483883')
    expect(res.status).toBe(502)
    expect((await json(res))['code']).toBe('PEGII_SOURCE_BAD_RESPONSE')
  })

  it('still returns a bare 500 for a genuine (non-pegII) bridge bug', async () => {
    findOrderById.mockRejectedValue(new Error('boom — real bug in the bridge'))
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/orders/483883')
    expect(res.status).toBe(500)
    expect((await json(res))['code']).toBe('INTERNAL_ERROR')
  })
})

describe('GET /pegii/orders/search', () => {
  const item = {
    orderNumber: 490317,
    shipmentStatus: 'A',
    pack: { planned: '2026-10-20', earliest: null, latest: '2026-10-20', actual: null },
    texting: {
      status: 'Allowed',
      orderAllows: true,
      accountBlocks: false,
      parentAccountBlocks: false,
    },
  }
  const url = (q: string) => `/pegii/orders/search?${q}`

  it('passes the live search page through for workflow_runtime', async () => {
    searchOrders.mockResolvedValue({ items: [item], nextCursor: 490317 })
    const app = buildApp(['workflow_runtime'])
    const res = await app.request(
      url('dateField=plan_pack&from=2026-10-20&to=2026-10-21&status=*&cursor=12&limit=50'),
    )
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({
      data: [item],
      meta: { count: 1, nextCursor: 490317 },
    })
    expect(searchOrders).toHaveBeenCalledWith({
      dateField: 'plan_pack',
      from: '2026-10-20',
      to: '2026-10-21',
      status: '*',
      cursor: 12,
      limit: 50,
    })
    // "search" is its own route, never read as an order id.
    expect(findOrderById).not.toHaveBeenCalled()
  })

  it('omits criteria the caller left out, so the site applies its defaults', async () => {
    searchOrders.mockResolvedValue({ items: [], nextCursor: null })
    const app = buildApp(['workflow_runtime'])
    const res = await app.request(url('dateField=del_actual&from=2026-10-01&to=2026-10-01'))
    expect(res.status).toBe(200)
    expect((await json(res))['meta']).toEqual({ count: 0, nextCursor: null })
    expect(searchOrders).toHaveBeenCalledWith({
      dateField: 'del_actual',
      from: '2026-10-01',
      to: '2026-10-01',
    })
  })

  it.each([
    ['an unknown dateField', 'dateField=move_desc&from=2026-10-01&to=2026-10-01', /dateField/],
    ['a missing from', 'dateField=plan_pack&to=2026-10-01', /from/],
    ['a non-ISO date', 'dateField=plan_pack&from=10/01/2026&to=2026-10-01', /YYYY-MM-DD/],
    ['an impossible month', 'dateField=plan_pack&from=2026-13-01&to=2026-10-01', /real date/],
    ['a rolled-over day', 'dateField=plan_pack&from=2026-02-30&to=2026-03-05', /real date/],
    ['to before from', 'dateField=plan_pack&from=2026-10-02&to=2026-10-01', /on or after/],
    ['a span over 366 days', 'dateField=plan_pack&from=2025-01-01&to=2026-10-01', /366/],
    [
      'a two-letter status',
      'dateField=plan_pack&from=2026-10-01&to=2026-10-01&status=AB',
      /status/,
    ],
    ['a limit over 500', 'dateField=plan_pack&from=2026-10-01&to=2026-10-01&limit=501', /limit/],
    ['a negative cursor', 'dateField=plan_pack&from=2026-10-01&to=2026-10-01&cursor=-1', /cursor/],
    ['an unknown param', 'dateField=plan_pack&from=2026-10-01&to=2026-10-01&page=2', /page/],
  ])('rejects %s with 400 before calling the site', async (_label, q, message) => {
    const app = buildApp(['workflow_runtime'])
    const res = await app.request(url(q))
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['code']).toBe('VALIDATION_ERROR')
    expect(String(body['error'])).toMatch(message)
    expect(searchOrders).not.toHaveBeenCalled()
  })

  it('rejects a role without ReadOrder (workflow_developer) with 403', async () => {
    const app = buildApp(['workflow_developer'])
    const res = await app.request(url('dateField=plan_pack&from=2026-10-20&to=2026-10-20'))
    expect(res.status).toBe(403)
    expect(searchOrders).not.toHaveBeenCalled()
  })

  it('returns 503 PEGII_CAPABILITY_MISSING when the site predates the search', async () => {
    searchOrders.mockRejectedValue(
      new PegiiApiError('PEGII_API_CAPABILITY_MISSING', 'does not support: pegii.orders.search.v1'),
    )
    const app = buildApp(['workflow_runtime'])
    const res = await app.request(url('dateField=plan_pack&from=2026-10-20&to=2026-10-20'))
    expect(res.status).toBe(503)
    expect((await json(res))['code']).toBe('PEGII_CAPABILITY_MISSING')
  })

  it("passes the site's own 400 through with its code", async () => {
    searchOrders.mockRejectedValue(
      new PegiiApiError(
        'PEGII_API_HTTP_ERROR',
        'pegII API 400: VALIDATION_ERROR — x',
        400,
        'VALIDATION_ERROR',
      ),
    )
    const app = buildApp(['workflow_runtime'])
    const res = await app.request(url('dateField=plan_pack&from=2026-10-20&to=2026-10-20'))
    expect(res.status).toBe(400)
    expect((await json(res))['code']).toBe('VALIDATION_ERROR')
  })

  it('returns 502 when the pegII source is unreachable', async () => {
    searchOrders.mockRejectedValue(
      new PegiiApiError('PEGII_API_TUNNEL_ERROR', 'connection refused'),
    )
    const app = buildApp(['workflow_runtime'])
    const res = await app.request(url('dateField=plan_pack&from=2026-10-20&to=2026-10-20'))
    expect(res.status).toBe(502)
    expect((await json(res))['code']).toBe('PEGII_SOURCE_UNREACHABLE')
  })
})

describe('GET /pegii/orders (deprecated)', () => {
  it('answers [] with Deprecation headers pointing at the search (source reachable)', async () => {
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/orders?status=booked')
    expect(res.status).toBe(200)
    expect(res.headers.get('deprecation')).toBe('true')
    expect(res.headers.get('link')).toContain('/api/v1/pegii/orders/search')
    const body = await json(res)
    expect(body['data']).toEqual([])
    expect(body['meta']).toMatchObject({ count: 0 })
    expect(checkReachable).toHaveBeenCalled()
  })

  // AC: list_orders and get_order agree on reachability — the list must not
  // return `200 []` while a by-id read 502s for the same down tenant.
  it('returns 502 (not 200 []) when the pegII source is unreachable', async () => {
    checkReachable.mockRejectedValue(
      new PegiiApiError('PEGII_API_TUNNEL_ERROR', 'connection refused'),
    )
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/orders')
    expect(res.status).toBe(502)
    expect((await json(res))['code']).toBe('PEGII_SOURCE_UNREACHABLE')
  })

  it('returns 503 when the tenant has no configured pegII source', async () => {
    vi.mocked(resolveOrderGateway).mockRejectedValueOnce(
      new PegiiApiError('PEGII_API_NOT_CONFIGURED', 'no reachable pegII order source'),
    )
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/orders')
    expect(res.status).toBe(503)
    expect((await json(res))['code']).toBe('PEGII_SOURCE_UNAVAILABLE')
  })
})

describe('GET /pegii/salesmen/:salesmanId', () => {
  it('returns the gateway-fetched salesman for workflow_runtime', async () => {
    findSalesmanById.mockResolvedValue(salesmanRecord({ id: 'sm-9', name: 'Dana Rivers' }))
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/salesmen/sm-9')
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({ id: 'sm-9', name: 'Dana Rivers' })
    expect(findSalesmanById).toHaveBeenCalledWith('sm-9')
  })

  it('returns 404 when the gateway reports no such salesman', async () => {
    findSalesmanById.mockResolvedValue(null)
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/salesmen/sm-missing')
    expect(res.status).toBe(404)
    expect((await json(res))['code']).toBe('NOT_FOUND')
  })

  it('rejects a role without ReadSalesman (workflow_developer) with 403', async () => {
    const app = buildApp(['workflow_developer'])
    const res = await app.request('/pegii/salesmen/sm-1')
    expect(res.status).toBe(403)
    expect(findSalesmanById).not.toHaveBeenCalled()
  })

  it('returns 502 when the pegII source is unreachable', async () => {
    findSalesmanById.mockRejectedValue(
      new PegiiApiError('PEGII_API_TUNNEL_ERROR', 'PROXY_INVOKE_FAILED: connect timed out'),
    )
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/salesmen/42')
    expect(res.status).toBe(502)
    expect((await json(res))['code']).toBe('PEGII_SOURCE_UNREACHABLE')
  })

  it('returns 503 when the tenant has no configured pegII source', async () => {
    vi.mocked(resolveSalesmanGateway).mockRejectedValueOnce(
      new PegiiApiError(
        'PEGII_API_NOT_CONFIGURED',
        'tenant has no reachable pegII salesman source',
      ),
    )
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/salesmen/42')
    expect(res.status).toBe(503)
    expect((await json(res))['code']).toBe('PEGII_SOURCE_UNAVAILABLE')
  })
})

describe('GET /pegii/salesmen', () => {
  it('lists the pegII directory, passing the active filter through', async () => {
    listSalesmen.mockResolvedValue([
      salesmanRecord({ id: 'sm-1', active: true, winUsername: 'jdoe' }),
      salesmanRecord({ id: 'sm-2', active: true }),
    ])
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/salesmen?active=true')
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body['data'] as Array<Record<string, unknown>>
    expect(data.map((s) => s['id'])).toEqual(['sm-1', 'sm-2'])
    expect(body['meta']).toEqual({ count: 2 })
    expect(listSalesmen).toHaveBeenCalledWith({ active: true })
  })

  it('never exposes the Windows username to workflows', async () => {
    listSalesmen.mockResolvedValue([salesmanRecord({ winUsername: 'jdoe' })])
    const app = buildApp(['workflow_runtime'])
    const data = (await json(await app.request('/pegii/salesmen')))['data'] as Array<
      Record<string, unknown>
    >
    expect(data[0]).not.toHaveProperty('winUsername')
    expect(listSalesmen).toHaveBeenCalledWith({})
  })

  it('returns 502 (not 200 []) when the pegII source is unreachable', async () => {
    listSalesmen.mockRejectedValue(
      new PegiiApiError('PEGII_API_TUNNEL_ERROR', 'connection refused'),
    )
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/salesmen')
    expect(res.status).toBe(502)
    expect((await json(res))['code']).toBe('PEGII_SOURCE_UNREACHABLE')
  })

  it('returns 503 when the site predates the salesmen list capability', async () => {
    listSalesmen.mockRejectedValue(
      new PegiiApiError('PEGII_API_CAPABILITY_MISSING', 'does not support: pegii.salesmen.list.v1'),
    )
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/salesmen')
    expect(res.status).toBe(503)
    expect((await json(res))['code']).toBe('PEGII_CAPABILITY_MISSING')
  })

  it('rejects a role without ReadSalesman (workflow_developer) with 403', async () => {
    const app = buildApp(['workflow_developer'])
    const res = await app.request('/pegii/salesmen')
    expect(res.status).toBe(403)
  })
})

describe('GET /pegii/tasks', () => {
  it('lists seeded tasks for an order (workflow_runtime)', async () => {
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/tasks?orderId=ord-1')
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as Array<Record<string, unknown>>
    expect(data.length).toBeGreaterThan(0)
    expect(data.every((t) => t['orderId'] === 'ord-1')).toBe(true)
    expect(data.some((t) => t['taskType'] === 'date_confirmation')).toBe(true)
  })

  it('filters by status', async () => {
    const app = buildApp(['workflow_runtime'])
    await app.request(
      '/pegii/tasks/close',
      post({ orderId: 'ord-1', taskType: 'date_confirmation' }),
    )
    const res = await app.request('/pegii/tasks?orderId=ord-1&status=closed')
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as Array<Record<string, unknown>>
    expect(data.length).toBe(1)
    expect(data[0]?.['status']).toBe('closed')
  })

  it('rejects a role without ReadTask (workflow_developer) with 403', async () => {
    const app = buildApp(['workflow_developer'])
    const res = await app.request('/pegii/tasks?orderId=ord-1')
    expect(res.status).toBe(403)
  })
})

describe('GET /pegii/tasks/:taskId', () => {
  it('returns a task by id', async () => {
    const app = buildApp(['workflow_runtime'])
    const list = (await json(await app.request('/pegii/tasks?orderId=ord-9')))['data'] as Array<
      Record<string, unknown>
    >
    const taskId = list[0]?.['id'] as string
    const res = await app.request(`/pegii/tasks/${taskId}`)
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({ id: taskId, orderId: 'ord-9' })
  })

  it('returns 404 for an unknown task', async () => {
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/tasks/task_does_not_exist')
    expect(res.status).toBe(404)
  })
})

describe('PATCH /pegii/orders/:orderId', () => {
  const patch = (body: unknown): RequestInit => ({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const fragment = { Survey: { SerivceStatus: 'In Progress', APIShipmentStatus: 'Loaded' } }
  const written = {
    Id: 490317,
    Survey: { SerivceStatus: 'In Progress', APIShipmentStatus: 'Loaded' },
  }

  it('passes the native fragment through and returns the native order with meta.applied', async () => {
    updateOrderNative.mockResolvedValue({ found: true, order: written, applied: true })
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/orders/490317', patch(fragment))

    expect(res.status).toBe(200)
    expect(res.headers.get('x-pegasus-applied')).toBe('true')
    expect(await json(res)).toEqual({ data: written, meta: { applied: true } })
    expect(updateOrderNative).toHaveBeenCalledWith('490317', fragment)
  })

  it('reports an unchanged replay as applied: false', async () => {
    updateOrderNative.mockResolvedValue({ found: true, order: written, applied: false })
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/orders/490317', patch(fragment))

    expect(res.status).toBe(200)
    expect(res.headers.get('x-pegasus-applied')).toBe('false')
    expect((await json(res))['meta']).toEqual({ applied: false })
  })

  it.each([['[]'], ['"x"'], ['null'], ['not json']])(
    'rejects a non-object body %s with 400 before reaching pegII',
    async (body) => {
      const app = buildApp(['workflow_runtime'])

      const res = await app.request('/pegii/orders/490317', patch(body))

      expect(res.status).toBe(400)
      expect((await json(res))['code']).toBe('VALIDATION_ERROR')
      expect(updateOrderNative).not.toHaveBeenCalled()
    },
  )

  it("keeps pegII's 404 code (ORDER_NOT_FOUND / ORDER_SNAPSHOT_MISSING)", async () => {
    updateOrderNative.mockResolvedValue({
      found: false,
      code: 'ORDER_SNAPSHOT_MISSING',
      message: 'pegII API 404: ORDER_SNAPSHOT_MISSING — never saved',
    })
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/orders/490317', patch(fragment))

    expect(res.status).toBe(404)
    expect((await json(res))['code']).toBe('ORDER_SNAPSHOT_MISSING')
  })

  it("passes pegII's 400 (a path outside the allowlist) through, naming the path", async () => {
    updateOrderNative.mockRejectedValue(
      new PegiiApiError(
        'PEGII_API_HTTP_ERROR',
        "pegII API 400: VALIDATION_ERROR — 'Id' is not writable",
        400,
        'VALIDATION_ERROR',
      ),
    )
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/orders/490317', patch({ Id: '999' }))

    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['code']).toBe('VALIDATION_ERROR')
    expect(body['error']).toContain("'Id' is not writable")
  })

  it('answers 503 PEGII_CAPABILITY_MISSING on a site whose API predates the write', async () => {
    updateOrderNative.mockRejectedValue(
      new PegiiApiError('PEGII_API_CAPABILITY_MISSING', 'does not support: pegii.orders.write.v1'),
    )
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/orders/490317', patch(fragment))

    expect(res.status).toBe(503)
    expect((await json(res))['code']).toBe('PEGII_CAPABILITY_MISSING')
  })

  it('rejects a role without WriteOrder (workflow_developer) with 403', async () => {
    const app = buildApp(['workflow_developer'])

    const res = await app.request('/pegii/orders/490317', patch(fragment))

    expect(res.status).toBe(403)
    expect(updateOrderNative).not.toHaveBeenCalled()
  })
})

describe('POST /pegii/tasks/close', () => {
  it('closes a task and is idempotent', async () => {
    const app = buildApp(['workflow_runtime'])
    const body = { orderId: 'ord-1', taskType: 'date_confirmation', reason: 'packing date set' }

    const first = await app.request('/pegii/tasks/close', post(body))
    expect(first.status).toBe(200)
    const firstData = (await json(first))['data'] as Record<string, unknown>
    expect(firstData['status']).toBe('closed')
    expect(firstData['alreadyClosed']).toBe(false)
    expect(firstData['reason']).toBe('packing date set')

    const second = await app.request('/pegii/tasks/close', post(body))
    expect(second.status).toBe(200)
    const secondData = (await json(second))['data'] as Record<string, unknown>
    expect(secondData['status']).toBe('closed')
    expect(secondData['alreadyClosed']).toBe(true)
  })

  it('rejects a role without CloseTask (workflow_developer) with 403', async () => {
    const app = buildApp(['workflow_developer'])
    const res = await app.request(
      '/pegii/tasks/close',
      post({ orderId: 'ord-1', taskType: 'date_confirmation' }),
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 on an invalid body', async () => {
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/tasks/close', post({ orderId: '', taskType: 'x' }))
    expect(res.status).toBe(400)
  })

  // sdk-feedback 0046 B. A close that matched nothing used to answer 200 with
  // a row created and closed in the same millisecond, so "I closed the
  // follow-up" and "there was no follow-up" looked identical, and closing
  // nothing was billable. A miss is now a 404 that creates nothing.
  it('404s a task type that does not exist on the order, and creates nothing', async () => {
    const app = buildApp(['workflow_runtime'])

    const res = await app.request(
      '/pegii/tasks/close',
      post({ orderId: 'zzz-probe-order-0046', taskType: 'never_existed_type' }),
    )

    expect(res.status).toBe(404)
    expect(await json(res)).toMatchObject({ code: 'TASK_NOT_FOUND' })
    const list = (await json(await app.request('/pegii/tasks?orderId=zzz-probe-order-0046')))[
      'data'
    ] as Array<Record<string, unknown>>
    expect(list.map((t) => t['taskType'])).not.toContain('never_existed_type')
  })
})

// sdk-feedback 0046 C, interim. Until the real pegII task bridge lands (NW pulse
// Phase 6), every task row is synthesized. It has to SAY so, because a silent
// fake is what let this surface reach a customer proposal.
describe('stub task rows are marked', () => {
  it('carries stub: true on list, get and close', async () => {
    const app = buildApp(['workflow_runtime'])

    const list = (await json(await app.request('/pegii/tasks?orderId=ord-1')))['data'] as Array<
      Record<string, unknown>
    >
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((t) => t['stub'] === true)).toBe(true)

    const one = await json(await app.request(`/pegii/tasks/${String(list[0]?.['id'])}`))
    expect((one['data'] as Record<string, unknown>)['stub']).toBe(true)

    const closed = await json(
      await app.request(
        '/pegii/tasks/close',
        post({ orderId: 'ord-1', taskType: 'date_confirmation' }),
      ),
    )
    expect((closed['data'] as Record<string, unknown>)['stub']).toBe(true)
  })
})
