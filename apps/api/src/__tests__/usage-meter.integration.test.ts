/**
 * End-to-end usage meter through the REAL m2mV1 router — real `vnd_` auth,
 * real Cedar (offline wasm), real handler, real meter, real database.
 *
 * The Playwright suite cannot exercise this: its local API runs with
 * SKIP_AUTH, under which dual-auth turns every caller (a `vnd_` key included)
 * into a synthetic human tenant_admin — and humans are never metered. So the
 * runtime path is proven here instead, with a key shaped exactly like a
 * workflow runtime's: a workflow_runtime service account behind an ApiClient
 * named `wf-runtime-<workflowId>`.
 *
 * CloseTask is the billable route under test. Its pegII site is replaced by an
 * in-memory TaskGateway (the factory is mocked) holding one open task, so the
 * route, its close-by-(order, type) resolution and the meter all run for real.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import crypto from 'node:crypto'
import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest'
import type { PegiiTaskDto } from '../gateways/pegii/pegii-task.dto'
import { db } from '../db'
import { m2mV1 } from '../app'
import { _clearAuthzCache } from '../lib/authz'

// One open date_confirmation task on ORDER_NUMBER; closing it flips it closed.
const ORDER_NUMBER = 4_900_001
const { tasks } = vi.hoisted(() => ({ tasks: new Map<number, PegiiTaskDto>() }))
vi.mock('../gateways/task-gateway.factory', () => ({
  resolveTaskGateway: vi.fn(async () => ({
    listOrderTasks: async (n: number) => [...tasks.values()].filter((t) => t.orderNumber === n),
    getTask: async (id: number) => tasks.get(id) ?? null,
    searchTasks: async () => ({ items: [], nextCursor: null }),
    createTask: async () => {
      throw new Error('not used')
    },
    closeTask: async (id: number) => {
      const t = tasks.get(id)
      if (!t) return null
      if (t.completed) return { task: t, alreadyClosed: true }
      const closed = { ...t, completed: true }
      tasks.set(id, closed)
      return { task: closed, alreadyClosed: false }
    },
  })),
}))

const hasDb = Boolean(process.env['DATABASE_URL'])
const SLUG = 'test-usage-meter-e2e'

let tenantId: string
let creatorId: string
let serviceAccountId: string
let apiClientId: string
let plainKey: string
const workflowId = crypto.randomUUID()
const orderId = `usage-meter-${Date.now().toString(36)}`
const savedSkipAuth = process.env['SKIP_AUTH']

const runtime = (path: string, init: RequestInit = {}) =>
  m2mV1.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${plainKey}`, 'Content-Type': 'application/json' },
  })

const close = (order: string) =>
  runtime('/pegii/tasks/close', {
    method: 'POST',
    body: JSON.stringify({ orderId: order, taskType: 'date_confirmation' }),
  })

const seedTask = () =>
  tasks.set(501, {
    id: 501,
    orderNumber: ORDER_NUMBER,
    taskType: 'date_confirmation',
    title: 'DATE CONFIRMATION',
    description: null,
    priority: null,
    dueDate: null,
    assigneeCode: 0,
    completed: false,
    completedAt: null,
    completedBy: null,
    actualDate: null,
    active: true,
    createdByApi: false,
    closeReason: null,
    closedUtc: null,
    createdUtc: null,
  })

const metered = () => db.usageEvent.findMany({ where: { apiClientId } })

afterAll(async () => {
  if (savedSkipAuth === undefined) delete process.env['SKIP_AUTH']
  else process.env['SKIP_AUTH'] = savedSkipAuth
  if (hasDb) {
    await db.usageEvent.deleteMany({ where: { tenantId } }).catch(() => undefined)
    await db.apiClient.deleteMany({ where: { tenantId } }).catch(() => undefined)
    await db.tenantUser.deleteMany({ where: { tenantId } }).catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('usage meter through the real m2m stack (integration)', () => {
  beforeAll(async () => {
    delete process.env['SKIP_AUTH']
    process.env['AUTHZ_OFFLINE'] = 'true'
    _clearAuthzCache()

    const tenant = await db.tenant.upsert({
      where: { slug: SLUG },
      create: { name: 'Test Tenant (Usage Meter E2E)', slug: SLUG },
      update: {},
    })
    tenantId = tenant.id
    await db.usageEvent.deleteMany({ where: { tenantId } })
    await db.apiClient.deleteMany({ where: { tenantId } })
    await db.tenantUser.deleteMany({ where: { tenantId } })

    const creator = await db.tenantUser.create({
      data: { tenantId, email: `admin-${orderId}@test.invalid`, roleNames: ['tenant_admin'] },
    })
    creatorId = creator.id
    const svc = await db.tenantUser.create({
      data: {
        tenantId,
        email: `svc-${orderId}@svc.invalid`,
        isServiceAccount: true,
        roleNames: ['workflow_runtime'],
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    })
    serviceAccountId = svc.id

    plainKey = `vnd_${crypto.randomBytes(24).toString('hex')}`
    const client = await db.apiClient.create({
      data: {
        tenantId,
        name: `wf-runtime-${workflowId}`,
        keyPrefix: plainKey.slice(0, 12),
        keyHash: crypto.createHash('sha256').update(plainKey).digest('hex'),
        scopes: [],
        createdById: creatorId,
        actsAsUserId: serviceAccountId,
      },
    })
    apiClientId = client.id
  })

  it('a runtime close counts one action, attributed to the workflow', async () => {
    seedTask()
    const res = await close(String(ORDER_NUMBER))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { data: { alreadyClosed: boolean } }).data.alreadyClosed).toBe(
      false,
    )
    expect(await metered()).toEqual([
      expect.objectContaining({ tenantId, action: 'CloseTask', workflowId, apiClientId }),
    ])
  })

  it('a retry of the same close is a replay and counts nothing', async () => {
    const res = await close(String(ORDER_NUMBER))
    expect(((await res.json()) as { data: { alreadyClosed: boolean } }).data.alreadyClosed).toBe(
      true,
    )
    expect(await metered()).toHaveLength(1)
  })

  it('a close that matches no task is a 404 and counts nothing (sdk-feedback 0046)', async () => {
    const res = await runtime('/pegii/tasks/close', {
      method: 'POST',
      body: JSON.stringify({ orderId: String(ORDER_NUMBER), taskType: 'never_existed_type' }),
    })
    expect(res.status).toBe(404)
    expect(await metered()).toHaveLength(1)
  })

  it('a billable route that fails (non-2xx) counts nothing', async () => {
    // No RingCentral platform config in the test env → /sms/send answers 503.
    const res = await runtime('/sms/send', {
      method: 'POST',
      body: JSON.stringify({ to: '+15005550006', body: 'hello' }),
    })
    expect(res.status).toBe(503)
    expect(await metered()).toHaveLength(1)
  })

  it('the runtime reads its own usage (ReadUsage)', async () => {
    const res = await runtime('/usage/summary')
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as {
      data: {
        usedTermToDate: number
        byAction: Array<{ action: string; actions: number }>
        byWorkflow: Array<{ workflowId: string | null; actions: number }>
      }
    }
    expect(data.usedTermToDate).toBe(1)
    expect(data.byAction).toEqual([{ action: 'CloseTask', actions: 1 }])
    expect(data.byWorkflow).toEqual([expect.objectContaining({ workflowId, actions: 1 })])
  })
})
