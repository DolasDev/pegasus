// ---------------------------------------------------------------------------
// Unit tests for the pegII-runtime handler (workflow-runtime order + task reads).
//
// dualAuthMiddleware is stubbed to inject the AppEnv context; requirePermission
// is NOT mocked — real Cedar RBAC runs against workflow-runtime.cedar, so these
// tests double as verification that ReadOrder / ReadTask / CloseTask are granted
// to workflow_runtime and withheld from workflow_developer.
//
// Single-order reads go through the OrderGateway, so order-gateway.factory is
// mocked to a controllable stub (its own resolution + tunnel transport are
// covered in the gateway/factory unit tests). Task routes and order LISTING
// stay on the in-memory pegII stubs (services/pegii-tasks + services/
// pegii-orders), reset/seeded between cases.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { _clearAuthzCache } from '../lib/authz'
import { _resetTaskStore } from '../services/pegii-tasks'
import { _resetOrderStore, _seedOrder, type OrderRecord } from '../services/pegii-orders'

vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

const { findOrderById } = vi.hoisted(() => ({ findOrderById: vi.fn() }))
vi.mock('../gateways/order-gateway.factory', () => ({
  resolveOrderGateway: vi.fn(async () => ({ findOrderById })),
}))

import { pegiiRuntimeHandler } from './pegii-runtime'
import { dualAuthMiddleware } from '../middleware/dual-auth'

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

beforeEach(() => {
  vi.clearAllMocks()
  _clearAuthzCache()
  _resetTaskStore()
  _resetOrderStore()
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
})

describe('GET /pegii/orders', () => {
  it('lists seeded orders, filterable by status', async () => {
    _seedOrder('test-tenant-id', orderRecord({ id: 'ord-1', status: 'booked' }))
    _seedOrder('test-tenant-id', orderRecord({ id: 'ord-2', status: 'booked' }))
    _seedOrder('test-tenant-id', orderRecord({ id: 'ord-3', status: 'completed' }))
    const app = buildApp(['workflow_runtime'])
    const res = await app.request('/pegii/orders?status=booked')
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as Array<Record<string, unknown>>
    expect(data.length).toBe(2)
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
})
