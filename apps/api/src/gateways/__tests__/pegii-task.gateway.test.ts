import { describe, it, expect, vi } from 'vitest'
import { createPegiiTaskGateway } from '../pegii-task.gateway'
import { PegiiApiError, type PegiiApiClient } from '../../lib/pegii-api-client'
import type { PegiiTaskDto } from '../pegii/pegii-task.dto'

const BASE = 'https://pegii.test:8443'

const task = (over: Partial<PegiiTaskDto> = {}): PegiiTaskDto => ({
  id: 77,
  orderNumber: 490317,
  taskType: 'Pulse Follow-Up',
  title: 'Call back',
  description: null,
  priority: 'normal',
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

const notFound = (code?: string) =>
  new PegiiApiError('PEGII_API_HTTP_ERROR', `pegII API 404: ${code ?? 'UNKNOWN'} — x`, 404, code)

function gatewayWith(
  client: Partial<PegiiApiClient>,
  requireCapabilities = vi.fn().mockResolvedValue(undefined),
) {
  const full: PegiiApiClient = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    getHealth: vi.fn(),
    ...client,
  }
  return {
    requireCapabilities,
    gateway: createPegiiTaskGateway({
      tenantId: 't1',
      baseUrl: BASE,
      client: full,
      requireCapabilities,
    }),
  }
}

describe('createPegiiTaskGateway — capability gate', () => {
  it('requires pegii.tasks.v1 on EVERY call, reads included, before touching the site', async () => {
    const missing = new PegiiApiError('PEGII_API_CAPABILITY_MISSING', 'no tasks')
    const get = vi.fn()
    const post = vi.fn()
    const { gateway, requireCapabilities } = gatewayWith(
      { get, post },
      vi.fn().mockRejectedValue(missing),
    )

    // A site without the capability has no task routes: its 404 must not read as "not found".
    await expect(gateway.listOrderTasks(1)).rejects.toBe(missing)
    await expect(gateway.getTask(1)).rejects.toBe(missing)
    await expect(gateway.searchTasks({ taskType: 'Pulse Follow-Up' })).rejects.toBe(missing)
    await expect(
      gateway.createTask(1, { taskType: 'Pulse Follow-Up', title: 't', dueDate: '2026-10-20' }),
    ).rejects.toBe(missing)
    await expect(gateway.closeTask(1, null)).rejects.toBe(missing)

    expect(requireCapabilities).toHaveBeenCalledTimes(5)
    expect(requireCapabilities).toHaveBeenCalledWith(BASE, ['pegii.tasks.v1'], {})
    expect(get).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })
})

describe('createPegiiTaskGateway reads', () => {
  it('lists an order’s tasks', async () => {
    const get = vi
      .fn()
      .mockResolvedValue({ items: [task(), task({ id: 10, createdByApi: false })] })
    const { gateway } = gatewayWith({ get })

    const items = await gateway.listOrderTasks(490317)

    expect(get).toHaveBeenCalledWith('/api/v1/pegii/orders/490317/tasks')
    expect(items?.map((t) => t.id)).toEqual([77, 10])
  })

  it('an order with no tasks is [], an unknown order is null', async () => {
    const empty = gatewayWith({ get: vi.fn().mockResolvedValue({ items: [] }) })
    const unknown = gatewayWith({ get: vi.fn().mockRejectedValue(notFound('ORDER_NOT_FOUND')) })

    expect(await empty.gateway.listOrderTasks(1)).toEqual([])
    expect(await unknown.gateway.listOrderTasks(1)).toBeNull()
  })

  it('gets one task, null on 404', async () => {
    const found = gatewayWith({ get: vi.fn().mockResolvedValue(task()) })
    const missing = gatewayWith({ get: vi.fn().mockRejectedValue(notFound('TASK_NOT_FOUND')) })

    expect(await found.gateway.getTask(77)).toEqual(task())
    expect(await missing.gateway.getTask(77)).toBeNull()
  })

  it('a COMPANY_NOT_FOUND 404 is a site misconfiguration, never "no such task"', async () => {
    const err = notFound('COMPANY_NOT_FOUND')
    const { gateway } = gatewayWith({ get: vi.fn().mockRejectedValue(err) })

    await expect(gateway.getTask(77)).rejects.toBe(err)
  })

  it('searches with the criteria as query params', async () => {
    const get = vi.fn().mockResolvedValue({ items: [task()], nextCursor: 77 })
    const { gateway } = gatewayWith({ get })

    const page = await gateway.searchTasks({
      taskType: 'Pulse Follow-Up',
      open: true,
      dueBefore: '2026-10-20',
      cursor: 5,
      limit: 2,
    })

    expect(get).toHaveBeenCalledWith('/api/v1/pegii/tasks', {
      taskType: 'Pulse Follow-Up',
      open: 'true',
      dueBefore: '2026-10-20',
      cursor: 5,
      limit: 2,
    })
    expect(page).toEqual({ items: [task()], nextCursor: 77 })
  })

  it('omits open when the caller wants both', async () => {
    const get = vi.fn().mockResolvedValue({ items: [], nextCursor: null })
    const { gateway } = gatewayWith({ get })

    await gateway.searchTasks({ taskType: 'Pulse Follow-Up' })

    expect(get.mock.calls[0]?.[1]).toMatchObject({ open: undefined })
  })
})

describe('createPegiiTaskGateway writes', () => {
  const body = {
    taskType: 'Pulse Follow-Up',
    title: 'Call back',
    dueDate: '2026-10-20',
    idempotencyKey: 'k',
  }

  it('creates on the order and passes the outcome through', async () => {
    const post = vi.fn().mockResolvedValue({ task: task(), alreadyExists: true })
    const { gateway } = gatewayWith({ post })

    const result = await gateway.createTask(490317, body)

    expect(post).toHaveBeenCalledWith('/api/v1/pegii/orders/490317/tasks', body)
    expect(result).toEqual({ found: true, task: task(), alreadyExists: true })
  })

  it("maps the site's 404 to found: false, keeping pegII's code", async () => {
    const { gateway } = gatewayWith({
      post: vi.fn().mockRejectedValue(notFound('ORDER_NOT_FOUND')),
    })

    expect(await gateway.createTask(5, body)).toMatchObject({
      found: false,
      code: 'ORDER_NOT_FOUND',
    })
  })

  it("lets the site's 400/409 propagate (the router passes them through with pegII's code)", async () => {
    const conflict = new PegiiApiError(
      'PEGII_API_HTTP_ERROR',
      'reused',
      409,
      'IDEMPOTENCY_KEY_REUSED',
    )
    const { gateway } = gatewayWith({ post: vi.fn().mockRejectedValue(conflict) })

    await expect(gateway.createTask(5, body)).rejects.toBe(conflict)
  })

  it('closes by id with the reason, or an empty body without one', async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ task: task({ completed: true }), alreadyClosed: false })
    const { gateway } = gatewayWith({ post })

    await gateway.closeTask(77, 'Customer replied')
    await gateway.closeTask(78, null)

    expect(post).toHaveBeenNthCalledWith(1, '/api/v1/pegii/tasks/77/close', {
      reason: 'Customer replied',
    })
    expect(post).toHaveBeenNthCalledWith(2, '/api/v1/pegii/tasks/78/close', {})
  })

  it('a close of an unknown task is null', async () => {
    const { gateway } = gatewayWith({ post: vi.fn().mockRejectedValue(notFound('TASK_NOT_FOUND')) })

    expect(await gateway.closeTask(77, null)).toBeNull()
  })
})
