// ---------------------------------------------------------------------------
// Unit tests for the pegII-runtime handler (workflow-runtime order + task reads).
//
// dualAuthMiddleware is stubbed to inject the AppEnv context; requirePermission
// is NOT mocked — real Cedar RBAC runs against workflow-runtime.cedar, so these
// tests double as verification that ReadOrder / ReadSalesman / ReadTask /
// CreateTask / CloseTask are granted to workflow_runtime and withheld from workflow_developer.
//
// Single-order reads go through the OrderGateway, so order-gateway.factory is
// mocked to a controllable stub (its own resolution + tunnel transport are
// covered in the gateway/factory unit tests). Task routes go through the
// TaskGateway the same way (task-gateway.factory mocked).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { _clearAuthzCache } from '../lib/authz'
import type { PegiiTaskDto } from '../gateways/pegii/pegii-task.dto'
import type * as TaskStoreContextModule from '../lib/task-store-context'
import { TaskStoreError, type TaskRecord } from '../gateways/task.gateway'
import { pegiiTaskToRecord } from '../gateways/pegii-task.gateway'
import type { PegiiMemoDto } from '../gateways/pegii/pegii-memo.dto'
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

const { listOrderTasks, getTask, searchTasks, createTask, closeTask } = vi.hoisted(() => ({
  listOrderTasks: vi.fn(),
  getTask: vi.fn(),
  searchTasks: vi.fn(),
  createTask: vi.fn(),
  closeTask: vi.fn(),
}))
// The cloud store's gateway, beside the legacy one above.
const cloud = vi.hoisted(() => ({
  listOrderTasks: vi.fn(),
  getTask: vi.fn(),
  searchTasks: vi.fn(),
  createTask: vi.fn(),
  closeTask: vi.fn(),
}))
const { hasLegacyTaskStore } = vi.hoisted(() => ({ hasLegacyTaskStore: vi.fn() }))
vi.mock('../gateways/task-gateway.factory', () => {
  const legacy = { store: 'legacy', listOrderTasks, getTask, searchTasks, createTask, closeTask }
  const cloudGw = { store: 'cloud', ...cloud }
  return {
    resolveTaskGateway: vi.fn(async () => legacy),
    resolveCloudTaskGateway: vi.fn(() => cloudGw),
    resolveTaskGatewayForStore: vi.fn(async (store: string) =>
      store === 'cloud' ? cloudGw : legacy,
    ),
    hasLegacyTaskStore,
  }
})

// Routing and the move's dispatcher come from the tenant's settings and legacy
// DB; stub just those two and keep the rest of the module real.
const { taskRoutingFor, moveDispatcherFor } = vi.hoisted(() => ({
  taskRoutingFor: vi.fn(),
  moveDispatcherFor: vi.fn(),
}))
vi.mock('../lib/task-store-context', async (importOriginal) => ({
  ...(await importOriginal<typeof TaskStoreContextModule>()),
  taskRoutingFor,
  moveDispatcherFor,
}))

const { createMemo, listMemoTypes } = vi.hoisted(() => ({
  createMemo: vi.fn(),
  listMemoTypes: vi.fn(),
}))
vi.mock('../gateways/memo-gateway.factory', () => ({
  resolveMemoGateway: vi.fn(async () => ({ createMemo, listMemoTypes })),
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
  // Default: a tenant with a legacy store, no routing, and no cloud tasks.
  hasLegacyTaskStore.mockResolvedValue(true)
  taskRoutingFor.mockResolvedValue(null)
  moveDispatcherFor.mockResolvedValue({ found: false })
  cloud.listOrderTasks.mockResolvedValue([])
  _clearAuthzCache()
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

  it.each(['del_date', 'plan_del', 'sit_date', 'lng_dis_del_plan'])(
    'accepts the delivery/SIT dateField %s',
    async (dateField) => {
      searchOrders.mockResolvedValue({ items: [], nextCursor: null })
      const app = buildApp(['workflow_runtime'])
      const res = await app.request(url(`dateField=${dateField}&from=2026-10-01&to=2026-10-07`))
      expect(res.status).toBe(200)
      expect(searchOrders).toHaveBeenCalledWith({
        dateField,
        from: '2026-10-01',
        to: '2026-10-07',
      })
    },
  )

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

// ── Tasks (the site's task API through a TaskGateway; NW pulse Phase 6) ──

// The gateway hands the handler neutral TaskRecords; build them from the site's DTO.
const taskDto = (over: Partial<PegiiTaskDto> = {}): TaskRecord =>
  pegiiTaskToRecord({
    id: 77,
    orderNumber: 490317,
    taskType: 'Pulse Follow-Up',
    title: 'Call back the shipper',
    description: 'No reply to the pulse text',
    priority: 'high',
    dueDate: '2026-10-20',
    assigneeCode: 8121,
    completed: false,
    completedAt: null,
    completedBy: null,
    actualDate: null,
    active: true,
    createdByApi: true,
    closeReason: null,
    closedUtc: null,
    createdUtc: '2026-10-16T18:00:00Z',
    ...over,
  })

const desktopTask = (over: Partial<PegiiTaskDto> = {}): TaskRecord =>
  taskDto({
    id: 10,
    taskType: 'PACK',
    title: 'SCHEDULE PACK',
    priority: null,
    createdByApi: false,
    createdUtc: null,
    ...over,
  })

describe('GET /pegii/tasks', () => {
  it("maps an order's tasks, desktop and cloud, to the SDK shape — no stub flag", async () => {
    listOrderTasks.mockResolvedValue([desktopTask(), taskDto()])
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/tasks?orderId=490317')

    expect(res.status).toBe(200)
    expect(listOrderTasks).toHaveBeenCalledWith('490317')
    const body = await json(res)
    const data = body['data'] as Array<Record<string, unknown>>
    expect(data[1]).toEqual({
      id: '77',
      orderId: '490317',
      taskType: 'Pulse Follow-Up',
      title: 'Call back the shipper',
      description: 'No reply to the pulse text',
      priority: 'high',
      dueDate: '2026-10-20',
      assigneeCode: 8121,
      status: 'open',
      reason: null,
      createdByApi: true,
      active: true,
      completedAt: null,
      completedBy: null,
      actualDate: null,
      createdAt: '2026-10-16T18:00:00Z',
      closedAt: null,
      store: 'legacy',
      role: null,
      assigneeUnresolved: null,
    })
    expect(data[0]).toMatchObject({ id: '10', taskType: 'PACK', priority: null, createdAt: null })
    expect(data.every((t) => !('stub' in t))).toBe(true)
    expect(body['meta']).toEqual({ count: 2, nextCursor: null })
  })

  it('filters an order’s tasks by type (case-insensitive), status and dueBefore', async () => {
    listOrderTasks.mockResolvedValue([
      desktopTask(),
      taskDto({ id: 1, dueDate: '2026-10-10' }),
      taskDto({ id: 2, dueDate: '2026-10-30' }),
      taskDto({ id: 3, dueDate: '2026-10-11', completed: true }),
      taskDto({ id: 4, dueDate: null }),
    ])
    const app = buildApp(['workflow_runtime'])

    const res = await app.request(
      '/pegii/tasks?orderId=490317&taskType=pulse%20follow-up&status=open&dueBefore=2026-10-20',
    )

    const data = (await json(res))['data'] as Array<Record<string, unknown>>
    expect(data.map((t) => t['id'])).toEqual(['1'])
  })

  it('an order with no tasks is [], and an unknown order is 404 ORDER_NOT_FOUND', async () => {
    const app = buildApp(['workflow_runtime'])

    listOrderTasks.mockResolvedValueOnce([])
    const empty = await app.request('/pegii/tasks?orderId=490317')
    listOrderTasks.mockResolvedValueOnce(null)
    const missing = await app.request('/pegii/tasks?orderId=490318')

    expect(empty.status).toBe(200)
    expect((await json(empty))['data']).toEqual([])
    expect(missing.status).toBe(404)
    expect(await json(missing)).toMatchObject({ code: 'ORDER_NOT_FOUND' })
  })

  it('searches one type across orders and pages with a string cursor', async () => {
    searchTasks.mockResolvedValue({ items: [taskDto()], nextCursor: '77' })
    const app = buildApp(['workflow_runtime'])

    const res = await app.request(
      '/pegii/tasks?taskType=Pulse%20Follow-Up&status=open&dueBefore=2026-10-20&cursor=5&limit=1',
    )

    expect(res.status).toBe(200)
    expect(searchTasks).toHaveBeenCalledWith({
      taskType: 'Pulse Follow-Up',
      open: true,
      dueBefore: '2026-10-20',
      cursor: '5',
      limit: 1,
    })
    expect((await json(res))['meta']).toEqual({ count: 1, nextCursor: '77', store: 'legacy' })
    // A role-less search never reads the tenant's routing (the pre-3a path).
    expect(taskRoutingFor).not.toHaveBeenCalled()
  })

  it.each([
    ['', 'orderId or taskType is required'],
    ['?status=open', 'orderId or taskType is required'],
    ['?orderId=ord-1', 'pegII order number'],
    ['?orderId=490317&cursor=5', 'cursor/limit page the cross-order search'],
    ['?taskType=x&dueBefore=2026-02-30', 'not a real date'],
    ['?taskType=x&status=done', "status must be 'open' or 'closed'"],
    ['?taskType=x&limit=501', 'limit must be between'],
  ])('400s %j before calling the site', async (query, message) => {
    const app = buildApp(['workflow_runtime'])

    const res = await app.request(`/pegii/tasks${query}`)

    expect(res.status).toBe(400)
    expect(((await json(res))['error'] as string).includes(message)).toBe(true)
    expect(listOrderTasks).not.toHaveBeenCalled()
    expect(searchTasks).not.toHaveBeenCalled()
  })

  it('a site without pegii.tasks.v1 is 503 PEGII_CAPABILITY_MISSING, not an empty list', async () => {
    listOrderTasks.mockRejectedValue(
      new PegiiApiError('PEGII_API_CAPABILITY_MISSING', 'does not support: pegii.tasks.v1'),
    )
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/tasks?orderId=490317')

    expect(res.status).toBe(503)
    expect(await json(res)).toMatchObject({ code: 'PEGII_CAPABILITY_MISSING' })
  })

  it('rejects a role without ReadTask (workflow_developer) with 403', async () => {
    const app = buildApp(['workflow_developer'])
    const res = await app.request('/pegii/tasks?orderId=490317')
    expect(res.status).toBe(403)
  })
})

describe('GET /pegii/tasks/:taskId', () => {
  it('returns a task by id', async () => {
    getTask.mockResolvedValue(taskDto())
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/tasks/77')

    expect(res.status).toBe(200)
    expect(getTask).toHaveBeenCalledWith('77')
    expect((await json(res))['data']).toMatchObject({ id: '77', orderId: '490317' })
  })

  it('404s an unknown task, and a non-pegII id without calling the site', async () => {
    getTask.mockResolvedValue(null)
    const app = buildApp(['workflow_runtime'])

    const unknown = await app.request('/pegii/tasks/78')
    const stubId = await app.request('/pegii/tasks/task_490317_date_confirmation')

    expect(unknown.status).toBe(404)
    expect(stubId.status).toBe(404)
    expect(getTask).toHaveBeenCalledTimes(1)
  })
})

describe('POST /pegii/tasks (create)', () => {
  const create = {
    orderId: '490317',
    taskType: 'Pulse Follow-Up',
    title: 'Call back the shipper',
    description: 'No reply to the pulse text',
    priority: 'high',
    dueDate: '2026-10-20',
    assigneeCode: 8121,
    dedupKey: 'pulse-490317-2026-10-16',
  }

  it('creates on the site (dedupKey → idempotencyKey) and answers 201', async () => {
    createTask.mockResolvedValue({ found: true, task: taskDto(), alreadyExists: false })
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/tasks', post(create))

    expect(res.status).toBe(201)
    expect(createTask).toHaveBeenCalledWith('490317', {
      taskType: 'Pulse Follow-Up',
      title: 'Call back the shipper',
      description: 'No reply to the pulse text',
      priority: 'high',
      dueDate: '2026-10-20',
      assigneeCode: 8121,
      idempotencyKey: 'pulse-490317-2026-10-16',
    })
    expect((await json(res))['data']).toMatchObject({ id: '77', alreadyExists: false })
  })

  it('a replay with the same dedupKey answers 200 alreadyExists', async () => {
    createTask.mockResolvedValue({ found: true, task: taskDto(), alreadyExists: true })
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/tasks', post(create))

    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({ id: '77', alreadyExists: true })
  })

  it("an unknown order is 404 with pegII's code", async () => {
    createTask.mockResolvedValue({ found: false, code: 'ORDER_NOT_FOUND', message: 'x' })
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/tasks', post(create))

    expect(res.status).toBe(404)
    expect(await json(res)).toMatchObject({ code: 'ORDER_NOT_FOUND' })
  })

  it.each([
    ['UNKNOWN_TASK_TYPE', 400],
    ['UNKNOWN_ASSIGNEE', 400],
    ['IDEMPOTENCY_KEY_REUSED', 409],
  ])("the site's %s passes through as %i", async (code, status) => {
    createTask.mockRejectedValue(
      new PegiiApiError('PEGII_API_HTTP_ERROR', `pegII API ${status}: ${code}`, status, code),
    )
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/tasks', post(create))

    expect(res.status).toBe(status)
    expect(await json(res)).toMatchObject({ code })
  })

  it.each([
    [{ ...create, orderId: 'ord-1' }, 'pegII order number'],
    [{ ...create, dueDate: undefined }, 'dueDate is required'],
    [{ ...create, dueDate: '2026-02-30' }, 'not a real date'],
    [{ ...create, title: '  ' }, 'title is required'],
    [{ ...create, title: 'x'.repeat(201) }, 'at most 200'],
    [{ ...create, priority: 'urgent' }, "priority must be 'low', 'normal' or 'high'"],
    [{ ...create, assigneeCode: 0 }, 'employee code'],
    [{ ...create, dedupKey: 'k'.repeat(191) }, 'at most 190'],
    [{ ...create, extra: true }, 'Unrecognized key'],
  ])('400s an invalid body before calling the site (%#)', async (body, message) => {
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/tasks', post(body))

    expect(res.status).toBe(400)
    expect(((await json(res))['error'] as string).includes(message)).toBe(true)
    expect(createTask).not.toHaveBeenCalled()
  })

  it('accepts a task type with a space (the IDENT_RE that rejected it is gone)', async () => {
    createTask.mockResolvedValue({ found: true, task: taskDto(), alreadyExists: false })
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/tasks', post({ ...create, taskType: 'Pulse Follow-Up' }))

    expect(res.status).toBe(201)
  })

  it('rejects a role without CreateTask (workflow_developer) with 403', async () => {
    const app = buildApp(['workflow_developer'])

    const res = await app.request('/pegii/tasks', post(create))

    expect(res.status).toBe(403)
    expect(createTask).not.toHaveBeenCalled()
  })
})

describe('POST /pegii/tasks/close', () => {
  it('closes by taskId, passing the reason', async () => {
    closeTask.mockResolvedValue({
      task: taskDto({ completed: true, closeReason: 'Customer replied' }),
      alreadyClosed: false,
    })
    const app = buildApp(['workflow_runtime'])

    const res = await app.request(
      '/pegii/tasks/close',
      post({ taskId: '77', reason: 'Customer replied' }),
    )

    expect(res.status).toBe(200)
    expect(closeTask).toHaveBeenCalledWith('77', 'Customer replied')
    expect((await json(res))['data']).toMatchObject({
      id: '77',
      status: 'closed',
      reason: 'Customer replied',
      alreadyClosed: false,
    })
  })

  it("passes the site's alreadyClosed through on a repeat close by id", async () => {
    closeTask.mockResolvedValue({ task: taskDto({ completed: true }), alreadyClosed: true })
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/tasks/close', post({ taskId: 77 }))

    expect(closeTask).toHaveBeenCalledWith('77', null)
    expect((await json(res))['data']).toMatchObject({ alreadyClosed: true })
  })

  it('404s an unknown task id (and a non-pegII id without calling the site)', async () => {
    closeTask.mockResolvedValue(null)
    const app = buildApp(['workflow_runtime'])

    const unknown = await app.request('/pegii/tasks/close', post({ taskId: '78' }))
    const stubId = await app.request('/pegii/tasks/close', post({ taskId: 'task_1_x' }))

    expect(unknown.status).toBe(404)
    expect(await json(unknown)).toMatchObject({ code: 'TASK_NOT_FOUND' })
    expect(stubId.status).toBe(404)
    expect(closeTask).toHaveBeenCalledTimes(1)
  })

  describe('by (orderId, taskType)', () => {
    const byType = { orderId: '490317', taskType: 'pulse follow-up', reason: 'replied' }

    it('closes the one open task of that type', async () => {
      listOrderTasks.mockResolvedValue([
        desktopTask(),
        taskDto({ id: 70, completed: true }),
        taskDto({ id: 77 }),
      ])
      closeTask.mockResolvedValue({ task: taskDto({ completed: true }), alreadyClosed: false })
      const app = buildApp(['workflow_runtime'])

      const res = await app.request('/pegii/tasks/close', post(byType))

      expect(res.status).toBe(200)
      expect(closeTask).toHaveBeenCalledWith('77', 'replied')
    })

    it('two or more OPEN matches → 409 TASK_AMBIGUOUS naming them, nothing closed', async () => {
      listOrderTasks.mockResolvedValue([taskDto({ id: 77 }), taskDto({ id: 78 })])
      const app = buildApp(['workflow_runtime'])

      const res = await app.request('/pegii/tasks/close', post(byType))

      expect(res.status).toBe(409)
      expect(await json(res)).toMatchObject({ code: 'TASK_AMBIGUOUS', candidateIds: ['77', '78'] })
      expect(closeTask).not.toHaveBeenCalled()
    })

    it('none open but some closed → the latest, alreadyClosed (a genuine repeat close)', async () => {
      listOrderTasks.mockResolvedValue([
        taskDto({ id: 70, completed: true }),
        taskDto({ id: 77, completed: true, closeReason: 'replied' }),
      ])
      const app = buildApp(['workflow_runtime'])

      const res = await app.request('/pegii/tasks/close', post(byType))

      expect(res.status).toBe(200)
      expect((await json(res))['data']).toMatchObject({ id: '77', alreadyClosed: true })
      expect(closeTask).not.toHaveBeenCalled()
    })

    it('no task of that type → 404 TASK_NOT_FOUND; an unknown order → 404 ORDER_NOT_FOUND', async () => {
      const app = buildApp(['workflow_runtime'])

      listOrderTasks.mockResolvedValueOnce([desktopTask()])
      const none = await app.request('/pegii/tasks/close', post(byType))
      listOrderTasks.mockResolvedValueOnce(null)
      const noOrder = await app.request('/pegii/tasks/close', post(byType))

      expect(none.status).toBe(404)
      expect(await json(none)).toMatchObject({ code: 'TASK_NOT_FOUND' })
      expect(noOrder.status).toBe(404)
      expect(await json(noOrder)).toMatchObject({ code: 'ORDER_NOT_FOUND' })
      expect(closeTask).not.toHaveBeenCalled()
    })
  })

  it.each([
    [{}, 'exactly one'],
    [{ taskId: '77', orderId: '490317', taskType: 'x' }, 'exactly one'],
    [{ orderId: '490317' }, 'go together'],
    [{ taskType: 'x' }, 'go together'],
    [{ orderId: '', taskType: 'x' }, 'pegII order number'],
    [{ taskId: '77', reason: 'r'.repeat(1001) }, ''],
  ])('400s %j before calling the site', async (body, message) => {
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/tasks/close', post(body))

    expect(res.status).toBe(400)
    expect(((await json(res))['error'] as string).includes(message)).toBe(true)
    expect(listOrderTasks).not.toHaveBeenCalled()
    expect(closeTask).not.toHaveBeenCalled()
  })

  it('rejects a role without CloseTask (workflow_developer) with 403', async () => {
    const app = buildApp(['workflow_developer'])
    const res = await app.request('/pegii/tasks/close', post({ taskId: '77' }))
    expect(res.status).toBe(403)
  })
})

const memoDto = (over: Partial<PegiiMemoDto> = {}): PegiiMemoDto => ({
  id: 88,
  orderNumber: 490317,
  memoType: 4,
  subject: 'PULSE REPLY',
  text: 'Customer says the crew was great',
  nextAction: null,
  nextDate: '2026-10-19',
  callDate: '2026-10-19',
  callTime: '2026-10-19T14:05:00',
  whoCalled: 'PEGASUS GENERATED',
  shipper: 'DOE, JANE',
  personCode: 8121,
  acknowledged: false,
  createdBy: 1001,
  ...over,
})

describe('POST /pegii/orders/:orderId/memos', () => {
  const memo = {
    memoType: 4,
    subject: 'Pulse reply',
    text: 'Customer says the crew was great',
    nextAction: 'Call the customer back',
    nextDate: '2026-10-20',
    personCode: 8121,
    dedupKey: 'pulse-memo-490317-4455',
  }

  it('adds the memo on the site (dedupKey → idempotencyKey) and answers 201', async () => {
    createMemo.mockResolvedValue({ found: true, memo: memoDto(), alreadyExists: false })
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/orders/490317/memos', post(memo))

    expect(res.status).toBe(201)
    expect(createMemo).toHaveBeenCalledWith(490317, {
      memoType: 4,
      subject: 'Pulse reply',
      text: 'Customer says the crew was great',
      nextAction: 'Call the customer back',
      nextDate: '2026-10-20',
      personCode: 8121,
      idempotencyKey: 'pulse-memo-490317-4455',
    })
    expect((await json(res))['data']).toEqual({
      id: '88',
      orderId: '490317',
      memoType: 4,
      subject: 'PULSE REPLY',
      text: 'Customer says the crew was great',
      nextAction: null,
      nextDate: '2026-10-19',
      callDate: '2026-10-19',
      callTime: '2026-10-19T14:05:00',
      whoCalled: 'PEGASUS GENERATED',
      shipper: 'DOE, JANE',
      personCode: 8121,
      acknowledged: false,
      createdBy: 1001,
      alreadyExists: false,
    })
  })

  it('sends only the fields given (the site defaults person, next date)', async () => {
    createMemo.mockResolvedValue({ found: true, memo: memoDto(), alreadyExists: false })
    const app = buildApp(['workflow_runtime'])

    await app.request(
      '/pegii/orders/490317/memos',
      post({ memoType: 4, subject: 'Pulse reply', text: 'Thanks' }),
    )

    expect(createMemo).toHaveBeenCalledWith(490317, {
      memoType: 4,
      subject: 'Pulse reply',
      text: 'Thanks',
    })
  })

  it('a replay with the same dedupKey answers 200 alreadyExists', async () => {
    createMemo.mockResolvedValue({ found: true, memo: memoDto(), alreadyExists: true })
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/orders/490317/memos', post(memo))

    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({ id: '88', alreadyExists: true })
  })

  it("an unknown order is 404 with pegII's code", async () => {
    createMemo.mockResolvedValue({ found: false, code: 'ORDER_NOT_FOUND', message: 'x' })
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/orders/490317/memos', post(memo))

    expect(res.status).toBe(404)
    expect(await json(res)).toMatchObject({ code: 'ORDER_NOT_FOUND' })
  })

  it.each([
    ['MEMO_TEXT_TRIGGERS_REJECTION', 400],
    ['UNKNOWN_PERSON', 400],
    ['IDEMPOTENCY_KEY_REUSED', 409],
    ['IDEMPOTENT_MEMO_DELETED', 409],
  ])("the site's %s passes through as %i", async (code, status) => {
    createMemo.mockRejectedValue(
      new PegiiApiError('PEGII_API_HTTP_ERROR', `pegII API ${status}: ${code}`, status, code),
    )
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/orders/490317/memos', post(memo))

    expect(res.status).toBe(status)
    expect(await json(res)).toMatchObject({ code })
  })

  it('a site without pegii.memos.v1 is 503 PEGII_CAPABILITY_MISSING', async () => {
    createMemo.mockRejectedValue(
      new PegiiApiError('PEGII_API_CAPABILITY_MISSING', 'site lacks pegii.memos.v1'),
    )
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/orders/490317/memos', post(memo))

    expect(res.status).toBe(503)
    expect(await json(res)).toMatchObject({ code: 'PEGII_CAPABILITY_MISSING' })
  })

  it.each([
    [{ ...memo, memoType: undefined }, 'memoType is required'],
    [{ ...memo, memoType: 8 }, 'between 1 and 7'],
    [{ ...memo, memoType: 0 }, 'between 1 and 7'],
    [{ ...memo, subject: '  ' }, 'subject is required'],
    [{ ...memo, subject: 'x'.repeat(151) }, 'at most 150'],
    [{ ...memo, text: undefined }, 'text is required'],
    [{ ...memo, text: 'x'.repeat(1001) }, 'at most 1000'],
    [{ ...memo, nextAction: 'x'.repeat(101) }, 'at most 100'],
    [{ ...memo, nextDate: '2026-02-30' }, 'not a real date'],
    [{ ...memo, personCode: 0 }, 'employee code'],
    [{ ...memo, dedupKey: 'k'.repeat(191) }, 'at most 190'],
    [{ ...memo, extra: true }, 'Unrecognized key'],
  ])('400s an invalid body before calling the site (%#)', async (body, message) => {
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/orders/490317/memos', post(body))

    expect(res.status).toBe(400)
    expect(((await json(res))['error'] as string).includes(message)).toBe(true)
    expect(createMemo).not.toHaveBeenCalled()
  })

  it.each(['ord-1', '0', '99999999999', '12a'])(
    '400s a non-numeric order id (%s) before calling the site',
    async (orderId) => {
      const app = buildApp(['workflow_runtime'])

      const res = await app.request(`/pegii/orders/${orderId}/memos`, post(memo))

      expect(res.status).toBe(400)
      expect(createMemo).not.toHaveBeenCalled()
    },
  )

  it('rejects a role without WriteOrderMemo (workflow_developer) with 403', async () => {
    const app = buildApp(['workflow_developer'])

    const res = await app.request('/pegii/orders/490317/memos', post(memo))

    expect(res.status).toBe(403)
    expect(createMemo).not.toHaveBeenCalled()
  })
})

describe('GET /pegii/memo-types', () => {
  it("returns the site's labels and company", async () => {
    listMemoTypes.mockResolvedValue({
      company: 'NW',
      items: [
        { code: 4, label: 'Customer Service' },
        { code: 5, label: 'Claims' },
      ],
    })
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/memo-types')

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({
      data: [
        { code: 4, label: 'Customer Service' },
        { code: 5, label: 'Claims' },
      ],
      meta: { company: 'NW', count: 2 },
    })
  })

  it('a site without pegii.memos.v1 is 503 PEGII_CAPABILITY_MISSING', async () => {
    listMemoTypes.mockRejectedValue(
      new PegiiApiError('PEGII_API_CAPABILITY_MISSING', 'site lacks pegii.memos.v1'),
    )
    const app = buildApp(['workflow_runtime'])

    const res = await app.request('/pegii/memo-types')

    expect(res.status).toBe(503)
  })
})

// ── Tasks across the two stores (task queue Phase 3a step 5) ─────────────────

const CLOUD_ID = '2b916653-df32-438d-a885-e9aedae40286'

const cloudTask = (over: Partial<TaskRecord> = {}): TaskRecord => ({
  store: 'cloud',
  id: CLOUD_ID,
  orderId: '490317',
  taskType: 'Confirm Actuals',
  title: 'Confirm actuals with PVO',
  description: null,
  priority: 'normal',
  dueDate: null,
  assigneeCode: 1196,
  status: 'open',
  reason: null,
  createdByApi: true,
  active: true,
  completedAt: null,
  completedBy: null,
  actualDate: null,
  createdAt: '2026-11-23T10:00:00.000Z',
  closedAt: null,
  role: 'operations',
  assigneeUnresolved: null,
  ...over,
})

const createBody = {
  orderId: '490317',
  taskType: 'Confirm Actuals',
  title: 'Confirm actuals with PVO',
}

describe('POST /pegii/tasks — routing by role', () => {
  it('a role-less create is legacy, exactly as before (no routing read needed to decide)', async () => {
    createTask.mockResolvedValue({ found: true, task: taskDto(), alreadyExists: false })

    const res = await buildApp().request(
      '/pegii/tasks',
      post({ ...createBody, dueDate: '2026-12-01' }),
    )

    expect(res.status).toBe(201)
    expect(cloud.createTask).not.toHaveBeenCalled()
    expect(moveDispatcherFor).not.toHaveBeenCalled()
    expect(taskRoutingFor).not.toHaveBeenCalled()
    expect((await json(res))['data']).toMatchObject({ store: 'legacy', role: null })
  })

  it('a role-less create without dueDate keeps the VALIDATION_ERROR contract', async () => {
    const res = await buildApp().request('/pegii/tasks', post(createBody))

    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['code']).toBe('VALIDATION_ERROR')
    expect(body['error']).toMatch(/dueDate is required/)
  })

  it('an unknown role is 400 UNKNOWN_ROLE naming the valid ones', async () => {
    const res = await buildApp().request('/pegii/tasks', post({ ...createBody, role: 'OPS' }))

    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['code']).toBe('UNKNOWN_ROLE')
    expect(body['error']).toMatch(/operations, tenant_admin/)
  })

  it('a role with no routing entry falls back to legacy', async () => {
    taskRoutingFor.mockResolvedValue({ coordinator: 'cloud' })
    createTask.mockResolvedValue({ found: true, task: taskDto(), alreadyExists: false })

    const res = await buildApp().request(
      '/pegii/tasks',
      post({ ...createBody, role: 'sales', dueDate: '2026-12-01' }),
    )

    expect(res.status).toBe(201)
    expect(createTask).toHaveBeenCalledWith(
      '490317',
      expect.objectContaining({ role: 'sales', dueDate: '2026-12-01' }),
    )
    expect(cloud.createTask).not.toHaveBeenCalled()
  })

  it('a legacy-routed role without dueDate is 400 DUE_DATE_REQUIRED, before any legacy read', async () => {
    const res = await buildApp().request(
      '/pegii/tasks',
      post({ ...createBody, role: 'operations' }),
    )

    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ code: 'DUE_DATE_REQUIRED' })
    expect(moveDispatcherFor).not.toHaveBeenCalled()
    expect(createTask).not.toHaveBeenCalled()
  })

  it('legacy operations: the move dispatcher becomes the assigneeCode', async () => {
    moveDispatcherFor.mockResolvedValue({ found: true, employeeCode: 1196, tenantUserId: null })
    createTask.mockResolvedValue({ found: true, task: taskDto(), alreadyExists: false })

    const res = await buildApp().request(
      '/pegii/tasks',
      post({ ...createBody, role: 'operations', dueDate: '2026-12-01' }),
    )

    expect(res.status).toBe(201)
    expect(moveDispatcherFor).toHaveBeenCalledWith(expect.anything(), 490317)
    expect(createTask).toHaveBeenCalledWith(
      '490317',
      expect.objectContaining({ assigneeCode: 1196 }),
    )
  })

  it('legacy operations with no dispatcher is 409 ASSIGNEE_UNRESOLVED, never the coordinator', async () => {
    const res = await buildApp().request(
      '/pegii/tasks',
      post({ ...createBody, role: 'operations', dueDate: '2026-12-01' }),
    )

    expect(res.status).toBe(409)
    expect(await json(res)).toMatchObject({ code: 'ASSIGNEE_UNRESOLVED' })
    expect(createTask).not.toHaveBeenCalled()
  })

  it('legacy operations with an explicit assigneeCode skips the dispatcher read', async () => {
    createTask.mockResolvedValue({ found: true, task: taskDto(), alreadyExists: false })

    await buildApp().request(
      '/pegii/tasks',
      post({ ...createBody, role: 'operations', dueDate: '2026-12-01', assigneeCode: 42 }),
    )

    expect(moveDispatcherFor).not.toHaveBeenCalled()
    expect(createTask).toHaveBeenCalledWith('490317', expect.objectContaining({ assigneeCode: 42 }))
  })

  it('cloud operations: assigned to the dispatcher’s linked user; dueDate optional; 201', async () => {
    taskRoutingFor.mockResolvedValue({ operations: 'cloud' })
    moveDispatcherFor.mockResolvedValue({ found: true, employeeCode: 1196, tenantUserId: 'u-d' })
    cloud.createTask.mockResolvedValue({ found: true, task: cloudTask(), alreadyExists: false })

    const res = await buildApp().request(
      '/pegii/tasks',
      post({ ...createBody, role: 'operations', dedupKey: 'k' }),
    )

    expect(res.status).toBe(201)
    expect(createTask).not.toHaveBeenCalled()
    expect(cloud.createTask).toHaveBeenCalledWith('490317', {
      taskType: 'Confirm Actuals',
      title: 'Confirm actuals with PVO',
      role: 'operations',
      idempotencyKey: 'k',
      assignee: { userId: 'u-d', employeeCode: 1196, unresolved: null },
    })
    expect((await json(res))['data']).toMatchObject({
      id: CLOUD_ID,
      store: 'cloud',
      role: 'operations',
      assigneeUnresolved: null,
      alreadyExists: false,
    })
  })

  it('cloud operations with no dispatcher is created unassigned, flagged NO_DISPATCHER', async () => {
    taskRoutingFor.mockResolvedValue({ operations: 'cloud' })
    cloud.createTask.mockResolvedValue({
      found: true,
      task: cloudTask({ assigneeCode: null, assigneeUnresolved: 'NO_DISPATCHER' }),
      alreadyExists: false,
    })

    const res = await buildApp().request(
      '/pegii/tasks',
      post({ ...createBody, role: 'operations' }),
    )

    expect(res.status).toBe(201)
    expect(cloud.createTask).toHaveBeenCalledWith(
      '490317',
      expect.objectContaining({
        assignee: { userId: null, employeeCode: null, unresolved: 'NO_DISPATCHER' },
      }),
    )
    expect((await json(res))['data']).toMatchObject({ assigneeUnresolved: 'NO_DISPATCHER' })
  })

  it('a dispatcher read failure is 503 DISPATCHER_UNAVAILABLE, nothing created', async () => {
    const { DispatcherUnavailableError } = await vi.importActual<typeof TaskStoreContextModule>(
      '../lib/task-store-context',
    )
    taskRoutingFor.mockResolvedValue({ operations: 'cloud' })
    moveDispatcherFor.mockRejectedValue(new DispatcherUnavailableError(new Error('tunnel down')))

    const res = await buildApp().request(
      '/pegii/tasks',
      post({ ...createBody, role: 'operations' }),
    )

    expect(res.status).toBe(503)
    expect(await json(res)).toMatchObject({ code: 'DISPATCHER_UNAVAILABLE' })
    expect(cloud.createTask).not.toHaveBeenCalled()
  })

  it('assigneeCode on a cloud-routed role is 400 UNSUPPORTED_ON_CLOUD_STORE', async () => {
    taskRoutingFor.mockResolvedValue({ coordinator: 'cloud' })

    const res = await buildApp().request(
      '/pegii/tasks',
      post({ ...createBody, role: 'coordinator', assigneeCode: 42 }),
    )

    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ code: 'UNSUPPORTED_ON_CLOUD_STORE' })
    expect(cloud.createTask).not.toHaveBeenCalled()
  })

  it('a cloud store refusal (TaskStoreError) answers with its own code and status', async () => {
    taskRoutingFor.mockResolvedValue({ coordinator: 'cloud' })
    cloud.createTask.mockRejectedValue(
      new TaskStoreError('IDEMPOTENCY_KEY_REUSED', 409, 'dedupKey k was already used'),
    )

    const res = await buildApp().request(
      '/pegii/tasks',
      post({ ...createBody, role: 'coordinator', dedupKey: 'k' }),
    )

    expect(res.status).toBe(409)
    expect(await json(res)).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
  })
})

describe('GET /pegii/tasks — across stores', () => {
  it("merges an order's tasks from both stores, legacy first, each with its store", async () => {
    listOrderTasks.mockResolvedValue([taskDto()])
    cloud.listOrderTasks.mockResolvedValue([cloudTask()])

    const res = await buildApp().request('/pegii/tasks?orderId=490317')

    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as Array<Record<string, unknown>>
    expect(data.map((t) => t['store'])).toEqual(['legacy', 'cloud'])
  })

  it('a tenant with no legacy store lists only cloud tasks and never 404s', async () => {
    hasLegacyTaskStore.mockResolvedValue(false)

    const res = await buildApp().request('/pegii/tasks?orderId=490317')

    expect(res.status).toBe(200)
    expect(listOrderTasks).not.toHaveBeenCalled()
    expect((await json(res))['data']).toEqual([])
  })

  it('legacy says no such order but the cloud has tasks on it: the cloud tasks', async () => {
    listOrderTasks.mockResolvedValue(null)
    cloud.listOrderTasks.mockResolvedValue([cloudTask()])

    const res = await buildApp().request('/pegii/tasks?orderId=490317')

    expect(res.status).toBe(200)
    expect(((await json(res))['data'] as unknown[]).length).toBe(1)
  })

  it('a role-scoped search goes to that role’s store and says which', async () => {
    taskRoutingFor.mockResolvedValue({ operations: 'cloud' })
    cloud.searchTasks.mockResolvedValue({ items: [cloudTask()], nextCursor: 'tok' })

    const res = await buildApp().request(
      '/pegii/tasks?taskType=Confirm%20Actuals&role=operations&cursor=abc',
    )

    expect(res.status).toBe(200)
    expect(cloud.searchTasks).toHaveBeenCalledWith({ taskType: 'Confirm Actuals', cursor: 'abc' })
    expect(searchTasks).not.toHaveBeenCalled()
    expect((await json(res))['meta']).toEqual({ count: 1, nextCursor: 'tok', store: 'cloud' })
  })

  it('a legacy search rejects a cursor it did not issue', async () => {
    const res = await buildApp().request('/pegii/tasks?taskType=Pulse%20Follow-Up&cursor=abc')

    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ code: 'INVALID_CURSOR' })
  })

  it('role with orderId is a 400 (an order lists every store)', async () => {
    const res = await buildApp().request('/pegii/tasks?orderId=490317&role=operations')

    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})

describe('GET /pegii/tasks/routing', () => {
  it('is not shadowed by /tasks/:taskId, and describes roles and stores', async () => {
    taskRoutingFor.mockResolvedValue({ operations: 'cloud' })

    const res = await buildApp().request('/pegii/tasks/routing')

    expect(res.status).toBe(200)
    expect(getTask).not.toHaveBeenCalled()
    const data = (await json(res))['data'] as Record<string, unknown>
    expect(data['defaultStore']).toBe('legacy')
    expect(data['legacyConfigured']).toBe(true)
    const roles = data['roles'] as Array<Record<string, unknown>>
    expect(roles.find((r) => r['role'] === 'operations')).toEqual({
      role: 'operations',
      store: 'cloud',
      configured: true,
    })
    expect(roles.find((r) => r['role'] === 'coordinator')).toEqual({
      role: 'coordinator',
      store: 'legacy',
      configured: false,
    })
    expect(data['stores']).toMatchObject({
      legacy: { dueDateRequired: true },
      cloud: { idFormat: 'uuid', rejects: ['assigneeCode'] },
    })
  })

  it('needs ReadTask', async () => {
    const res = await buildApp(['viewer']).request('/pegii/tasks/routing')
    expect(res.status).toBe(403)
  })
})

describe('by id: the id’s shape picks the store', () => {
  it('GET a UUID reads the cloud store', async () => {
    cloud.getTask.mockResolvedValue(cloudTask())

    const res = await buildApp().request(`/pegii/tasks/${CLOUD_ID}`)

    expect(res.status).toBe(200)
    expect(cloud.getTask).toHaveBeenCalledWith(CLOUD_ID)
    expect(getTask).not.toHaveBeenCalled()
  })

  it('close by a UUID closes in the cloud store', async () => {
    cloud.closeTask.mockResolvedValue({
      task: cloudTask({ status: 'closed', reason: 'ok' }),
      alreadyClosed: false,
    })

    const res = await buildApp().request(
      '/pegii/tasks/close',
      post({ taskId: CLOUD_ID, reason: 'ok' }),
    )

    expect(res.status).toBe(200)
    expect(cloud.closeTask).toHaveBeenCalledWith(CLOUD_ID, 'ok')
    expect(closeTask).not.toHaveBeenCalled()
  })

  it('close by (order, type) with one open task in each store is TASK_AMBIGUOUS across stores', async () => {
    listOrderTasks.mockResolvedValue([taskDto({ taskType: 'Confirm Actuals' })])
    cloud.listOrderTasks.mockResolvedValue([cloudTask()])

    const res = await buildApp().request(
      '/pegii/tasks/close',
      post({ orderId: '490317', taskType: 'confirm actuals' }),
    )

    expect(res.status).toBe(409)
    expect(await json(res)).toMatchObject({
      code: 'TASK_AMBIGUOUS',
      candidateIds: ['77', CLOUD_ID],
    })
  })

  it('close by (order, type) closes the one open task in whichever store holds it', async () => {
    listOrderTasks.mockResolvedValue([])
    cloud.listOrderTasks.mockResolvedValue([cloudTask()])
    cloud.closeTask.mockResolvedValue({
      task: cloudTask({ status: 'closed' }),
      alreadyClosed: false,
    })

    const res = await buildApp().request(
      '/pegii/tasks/close',
      post({ orderId: '490317', taskType: 'Confirm Actuals' }),
    )

    expect(res.status).toBe(200)
    expect(cloud.closeTask).toHaveBeenCalledWith(CLOUD_ID, null)
  })
})
