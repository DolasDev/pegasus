/**
 * One contract, both task stores (task queue plan Phase 3a, D8).
 *
 * The same cases run against:
 *   - `legacy`: the pegII gateway over an in-memory fake of the site's task
 *     routes (movemanager `TaskEndpoints`: idempotency by key + request,
 *     repeat close = alreadyClosed, 404 ORDER_NOT_FOUND / TASK_NOT_FOUND);
 *   - `cloud`: the cloud gateway over real `WorkItem` rows, through the
 *     tenant-scoped client production uses. Skipped without DATABASE_URL.
 *
 * A Workflow must not be able to tell which store answered except by `store`
 * and the id's shape, so every assertion here is store-neutral.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { db } from '../../db'
import { createTenantDb } from '../../lib/prisma'
import { PegiiApiError, type PegiiApiClient } from '../../lib/pegii-api-client'
import { createPegiiTaskGateway } from '../pegii-task.gateway'
import { createCloudTaskGateway } from '../cloud-task.gateway'
import { TaskStoreError, type TaskCreateInput, type TaskGateway } from '../task.gateway'
import type { PegiiTaskDto } from '../pegii/pegii-task.dto'

const hasDb = Boolean(process.env['DATABASE_URL'])
const KNOWN_ORDERS = new Set([490317, 490318])

// ── Fake pegII site ──────────────────────────────────────────────────────────

function fakeSite(): PegiiApiClient {
  const tasks = new Map<number, PegiiTaskDto>()
  const keys = new Map<string, { id: number; request: string }>()
  let nextId = 1000
  const notFound = (code: string) =>
    new PegiiApiError('PEGII_API_HTTP_ERROR', `pegII API 404: ${code}`, 404, code)

  const get = async (path: string, query?: Record<string, unknown>) => {
    let m = /^\/api\/v1\/pegii\/orders\/(\d+)\/tasks$/.exec(path)
    if (m) {
      const n = Number(m[1])
      if (!KNOWN_ORDERS.has(n)) throw notFound('ORDER_NOT_FOUND')
      return { items: [...tasks.values()].filter((t) => t.orderNumber === n) }
    }
    m = /^\/api\/v1\/pegii\/tasks\/(\d+)$/.exec(path)
    if (m) {
      const t = tasks.get(Number(m[1]))
      if (!t) throw notFound('TASK_NOT_FOUND')
      return t
    }
    if (path === '/api/v1/pegii/tasks') {
      const q = query ?? {}
      const type = String(q['taskType']).toLowerCase()
      const after = q['cursor'] === undefined ? 0 : Number(q['cursor'])
      const limit = q['limit'] === undefined ? 100 : Number(q['limit'])
      const open = q['open'] === undefined ? undefined : q['open'] === 'true'
      const all = [...tasks.values()]
        .filter((t) => t.createdByApi && t.taskType.toLowerCase() === type && t.id > after)
        .filter((t) => open === undefined || t.completed !== open)
        .sort((a, b) => a.id - b.id)
      const page = all.slice(0, limit)
      return {
        items: page,
        nextCursor: all.length > limit ? (page[page.length - 1]?.id ?? null) : null,
      }
    }
    throw new Error(`fake site: no GET ${path}`)
  }

  const post = async (path: string, body?: unknown) => {
    let m = /^\/api\/v1\/pegii\/orders\/(\d+)\/tasks$/.exec(path)
    if (m) {
      const n = Number(m[1])
      if (!KNOWN_ORDERS.has(n)) throw notFound('ORDER_NOT_FOUND')
      const b = body as Record<string, unknown>
      const { idempotencyKey, ...rest } = b
      const request = JSON.stringify(rest)
      if (typeof idempotencyKey === 'string') {
        const seen = keys.get(idempotencyKey)
        if (seen) {
          if (seen.request !== request) {
            throw new PegiiApiError('PEGII_API_HTTP_ERROR', 'reused', 409, 'IDEMPOTENCY_KEY_REUSED')
          }
          return { task: tasks.get(seen.id), alreadyExists: true }
        }
      }
      const id = nextId++
      const t: PegiiTaskDto = {
        id,
        orderNumber: n,
        taskType: String(b['taskType']),
        title: String(b['title']),
        description: (b['description'] as string | undefined) ?? null,
        priority: (b['priority'] as string | undefined) ?? 'normal',
        dueDate: String(b['dueDate']),
        assigneeCode: 8121,
        completed: false,
        completedAt: null,
        completedBy: null,
        actualDate: null,
        active: true,
        createdByApi: true,
        closeReason: null,
        closedUtc: null,
        createdUtc: new Date().toISOString(),
      }
      tasks.set(id, t)
      if (typeof idempotencyKey === 'string') keys.set(idempotencyKey, { id, request })
      return { task: t, alreadyExists: false }
    }
    m = /^\/api\/v1\/pegii\/tasks\/(\d+)\/close$/.exec(path)
    if (m) {
      const t = tasks.get(Number(m[1]))
      if (!t) throw notFound('TASK_NOT_FOUND')
      if (t.completed) return { task: t, alreadyClosed: true }
      const reason = (body as { reason?: string }).reason ?? null
      const closed = {
        ...t,
        completed: true,
        closeReason: reason,
        closedUtc: new Date().toISOString(),
      }
      tasks.set(t.id, closed)
      return { task: closed, alreadyClosed: false }
    }
    throw new Error(`fake site: no POST ${path}`)
  }

  return {
    get: get as PegiiApiClient['get'],
    post: post as PegiiApiClient['post'],
    put: async () => {
      throw new Error('unused')
    },
    patch: async () => {
      throw new Error('unused')
    },
    getHealth: async () => {
      throw new Error('unused')
    },
  } as PegiiApiClient
}

// ── Harnesses ────────────────────────────────────────────────────────────────

interface Harness {
  name: 'legacy' | 'cloud'
  skip: boolean
  /** A fresh, empty store. */
  make: () => Promise<TaskGateway>
  /** An id of the OTHER store's shape. */
  foreignId: string
}

const CLOUD_SLUG = 'test-task-gateway-contract'
let cloudTenantId = ''

const harnesses: Harness[] = [
  {
    name: 'legacy',
    skip: false,
    foreignId: '00000000-0000-4000-8000-000000000001',
    make: async () =>
      createPegiiTaskGateway({
        tenantId: 't1',
        baseUrl: 'https://pegii.test',
        client: fakeSite(),
        requireCapabilities: async () => undefined,
      }),
  },
  {
    name: 'cloud',
    skip: !hasDb,
    foreignId: '1000',
    make: async () => {
      await db.workItem.deleteMany({ where: { tenantId: cloudTenantId } })
      return createCloudTaskGateway({
        db: createTenantDb(db as unknown as PrismaClient, cloudTenantId) as unknown as PrismaClient,
        tenantId: cloudTenantId,
        orderExists: async (n) => KNOWN_ORDERS.has(n),
      })
    },
  },
]

beforeAll(async () => {
  if (!hasDb) return
  const t = await db.tenant.upsert({
    where: { slug: CLOUD_SLUG },
    create: { name: 'Test Tenant (task contract)', slug: CLOUD_SLUG },
    update: {},
  })
  cloudTenantId = t.id
})

afterAll(async () => {
  if (!hasDb) return
  await db.workItem.deleteMany({ where: { tenantId: cloudTenantId } }).catch(() => undefined)
  await db.$disconnect()
})

const input = (over: Partial<TaskCreateInput> = {}): TaskCreateInput => ({
  taskType: 'Pulse Follow-Up',
  title: 'Call back the shipper',
  dueDate: '2026-12-01',
  role: 'coordinator',
  ...over,
})

/** The refusal's code, whichever store raised it. */
function codeOf(err: unknown): string | undefined {
  if (err instanceof TaskStoreError) return err.code
  if (err instanceof PegiiApiError) return err.upstreamCode
  return undefined
}

// ── The contract ─────────────────────────────────────────────────────────────

describe.each(harnesses)('TaskGateway contract — $name store', (h) => {
  let gw: TaskGateway

  beforeEach(async () => {
    if (h.skip) return
    gw = await h.make()
  })

  it.skipIf(h.skip)('says which store it is, on the gateway and on every record', async () => {
    expect(gw.store).toBe(h.name)
    const created = await gw.createTask('490317', input())
    expect(created).toMatchObject({ found: true, alreadyExists: false })
    if (!created.found) throw new Error('unreachable')
    expect(created.task).toMatchObject({
      store: h.name,
      orderId: '490317',
      taskType: 'Pulse Follow-Up',
      title: 'Call back the shipper',
      dueDate: '2026-12-01',
      status: 'open',
      createdByApi: true,
      reason: null,
    })
    expect(await gw.getTask(created.task.id)).toEqual(created.task)
  })

  it.skipIf(h.skip)(
    'the same key + request replays the original; a different request is 409',
    async () => {
      const first = await gw.createTask('490317', input({ idempotencyKey: 'k-1' }))
      const again = await gw.createTask('490317', input({ idempotencyKey: 'k-1' }))
      if (!first.found || !again.found) throw new Error('unreachable')
      expect(again.alreadyExists).toBe(true)
      expect(again.task.id).toBe(first.task.id)

      const err = await gw
        .createTask('490317', input({ idempotencyKey: 'k-1', title: 'Something else' }))
        .catch((e: unknown) => e)
      expect(codeOf(err)).toBe('IDEMPOTENCY_KEY_REUSED')
    },
  )

  it.skipIf(h.skip)('an unknown order is found: false, ORDER_NOT_FOUND', async () => {
    expect(await gw.createTask('999999', input())).toMatchObject({
      found: false,
      code: 'ORDER_NOT_FOUND',
    })
  })

  it.skipIf(h.skip)('closes once; a repeat close is alreadyClosed', async () => {
    const created = await gw.createTask('490317', input())
    if (!created.found) throw new Error('unreachable')

    const closed = await gw.closeTask(created.task.id, 'Customer replied')
    expect(closed).toMatchObject({
      alreadyClosed: false,
      task: { id: created.task.id, status: 'closed', reason: 'Customer replied' },
    })
    expect(closed?.task.closedAt).not.toBeNull()

    const again = await gw.closeTask(created.task.id, null)
    expect(again).toMatchObject({ alreadyClosed: true, task: { status: 'closed' } })
  })

  it.skipIf(h.skip)(
    'an unknown id, or the other store’s id, is null for get and close',
    async () => {
      const created = await gw.createTask('490317', input())
      if (!created.found) throw new Error('unreachable')
      const unknown = h.name === 'legacy' ? '2147483000' : '00000000-0000-4000-8000-00000000ffff'

      expect(await gw.getTask(unknown)).toBeNull()
      expect(await gw.closeTask(unknown, null)).toBeNull()
      expect(await gw.getTask(h.foreignId)).toBeNull()
      expect(await gw.closeTask(h.foreignId, null)).toBeNull()
    },
  )

  it.skipIf(h.skip)('lists one order’s tasks and no other order’s', async () => {
    const a = await gw.createTask('490317', input({ title: 'A' }))
    await gw.createTask('490318', input({ title: 'B' }))
    if (!a.found) throw new Error('unreachable')

    const list = await gw.listOrderTasks('490317')
    expect(list?.map((t) => t.title)).toEqual(['A'])
  })

  it.skipIf(h.skip)('searches one type case-insensitively, filters open, and pages', async () => {
    for (const title of ['one', 'two', 'three']) {
      await gw.createTask('490317', input({ title }))
    }
    await gw.createTask('490317', input({ taskType: 'Other Type', title: 'other' }))
    const toClose = await gw.createTask('490317', input({ title: 'closed' }))
    if (!toClose.found) throw new Error('unreachable')
    await gw.closeTask(toClose.task.id, null)

    const p1 = await gw.searchTasks({ taskType: 'pulse follow-up', open: true, limit: 2 })
    expect(p1.items.map((t) => t.title)).toEqual(['one', 'two'])
    expect(p1.nextCursor).not.toBeNull()

    const p2 = await gw.searchTasks({
      taskType: 'pulse follow-up',
      open: true,
      limit: 2,
      cursor: p1.nextCursor!,
    })
    expect(p2.items.map((t) => t.title)).toEqual(['three'])
    expect(p2.nextCursor).toBeNull()

    const closedOnly = await gw.searchTasks({ taskType: 'Pulse Follow-Up', open: false })
    expect(closedOnly.items.map((t) => t.title)).toEqual(['closed'])
  })
})
