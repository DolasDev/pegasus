/**
 * Integration tests for POST /api/v1/pegii/tasks/:taskId/await (task queue
 * Phase 3b — the SDK's `await_task` registers its wait here).
 *
 * The real router, real Cedar RBAC and the real TaskAwait writes run against
 * Postgres through `createTenantDb`; only the task stores are faked (the
 * gateway factory), so a test controls what the task looks like on each read.
 * The caller scoping (a durable Workflow's token, an OPEN run of that same
 * Workflow in the caller's tenant) lives in the handler where Cedar can't see
 * it, so these tests are its gate.
 *
 * Requires a live PostgreSQL database; skipped when DATABASE_URL is not set.
 */
import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import type { TaskRecord } from '../gateways/task.gateway'
import { db } from '../db'
import { createTenantDb } from '../lib/prisma'
import { registerTestErrorHandler } from '../test-helpers'
import { _clearAuthzCache } from '../lib/authz'

vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

const { legacyGetTask, cloudGetTask } = vi.hoisted(() => ({
  legacyGetTask: vi.fn(),
  cloudGetTask: vi.fn(),
}))
vi.mock('../gateways/task-gateway.factory', () => ({
  resolveTaskGatewayForStore: vi.fn(async (store: string) =>
    store === 'cloud'
      ? { store: 'cloud', getTask: cloudGetTask }
      : { store: 'legacy', getTask: legacyGetTask },
  ),
  resolveTaskGateway: vi.fn(),
  resolveCloudTaskGateway: vi.fn(),
  hasLegacyTaskStore: vi.fn(async () => true),
}))

import { pegiiRuntimeHandler } from './pegii-runtime'
import { dualAuthMiddleware } from '../middleware/dual-auth'

const hasDb = Boolean(process.env['DATABASE_URL'])

const SLUG = 'test-task-await'
const SLUG_OTHER = 'test-task-await-other'
let tenantId = ''
let otherTenantId = ''

const CLOUD_TASK = '6f1c2a9e-1b2c-4d3e-8f90-0123456789ab'
const LEGACY_TASK = '4242'

function task(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    store: 'cloud',
    id: CLOUD_TASK,
    orderId: '500123',
    taskType: 'confirm-dates',
    title: 'Confirm dates',
    description: null,
    priority: 'normal',
    dueDate: null,
    assigneeCode: null,
    status: 'open',
    reason: null,
    createdByApi: true,
    active: true,
    completedAt: null,
    completedBy: null,
    actualDate: null,
    createdAt: null,
    closedAt: null,
    role: 'operations',
    assigneeUnresolved: null,
    ...over,
  }
}
const closed = (over: Partial<TaskRecord> = {}) =>
  task({ status: 'closed', reason: 'done', closedAt: '2026-11-24T10:00:00.000Z', ...over })

/** An app acting as runtime token `apiClientId` (or none) with `roleNames` in `tid`. */
function appAs(
  tid: string,
  apiClientId: string | undefined,
  roleNames: readonly string[] = ['workflow_runtime'],
) {
  vi.mocked(dualAuthMiddleware).mockImplementation(async (c, next) => {
    c.set('tenantId', tid)
    c.set('userId', 'svc-user')
    c.set('principal', { sub: 'svc-user', tenantId: tid, roleNames: [...roleNames] })
    c.set('idToken', undefined)
    c.set('policyStoreId', undefined)
    c.set('db', createTenantDb(db as unknown as PrismaClient, tid) as unknown as PrismaClient)
    if (apiClientId) c.set('apiClient', { id: apiClientId } as AppEnv['Variables']['apiClient'])
    await next()
  })
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.route('/pegii', pegiiRuntimeHandler)
  return app
}

async function awaitTask(
  opts: { tid?: string; client?: string | undefined; roles?: readonly string[] },
  taskId: string,
  body: unknown,
) {
  const app = appAs(opts.tid ?? tenantId, 'client' in opts ? opts.client : CLIENT, opts.roles)
  const res = await app.request(`/pegii/tasks/${taskId}/await`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

const data = (b: Record<string, unknown>) => b['data'] as Record<string, unknown>

async function seedWorkflow(tid: string, name: string, kind: 'AUTOMATION' | 'WORKFLOW') {
  return db.workflow.create({
    data: {
      tenantId: tid,
      name,
      version: '1.0.0',
      kind,
      artifactKey: `workflows/${tid}/${name}/1.0.0.zip`,
      manifest: { name, version: '1.0.0', entryPoints: ['main:W'] },
      createdByUserId: 'creator-1',
      executable: true,
      artifactSha256: `${name}`.padEnd(64, '0'),
      runtimeApiClientId: `client-${tid.slice(0, 8)}-${name}`,
      runtimeTokenCiphertext: 'ciphertext',
    },
  })
}

async function seedRun(
  tid: string,
  workflowId: string,
  temporalWorkflowId: string | null,
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' = 'RUNNING',
) {
  return db.workflowExecution.create({
    data: {
      tenantId: tid,
      workflowId,
      status,
      input: {},
      temporalWorkflowId,
      temporalRunId: temporalWorkflowId ? 'run-1' : null,
      queuedAt: new Date(),
      ...(status === 'QUEUED' ? {} : { startedAt: new Date() }),
    },
  })
}

async function wipe(tid: string) {
  await db.taskAwait.deleteMany({ where: { tenantId: tid } })
  await db.workflowExecution.deleteMany({ where: { tenantId: tid } })
  await db.workflow.deleteMany({ where: { tenantId: tid } })
}

const TEMPORAL_ID = 'wfl/t/order_lifecycle/o-1'
let CLIENT = ''
let lifecycle: Awaited<ReturnType<typeof seedWorkflow>>
let run: { id: string }

afterAll(async () => {
  if (!hasDb) return
  for (const t of [tenantId, otherTenantId].filter(Boolean)) await wipe(t).catch(() => undefined)
  await db.$disconnect()
})

describe.skipIf(!hasDb)('POST /pegii/tasks/:taskId/await (integration)', () => {
  beforeAll(async () => {
    const upsert = (slug: string) =>
      db.tenant.upsert({ where: { slug }, create: { name: slug, slug }, update: {} })
    tenantId = (await upsert(SLUG)).id
    otherTenantId = (await upsert(SLUG_OTHER)).id
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    _clearAuthzCache()
    await wipe(tenantId)
    await wipe(otherTenantId)
    lifecycle = await seedWorkflow(tenantId, 'order_lifecycle', 'WORKFLOW')
    CLIENT = lifecycle.runtimeApiClientId!
    run = await seedRun(tenantId, lifecycle.id, TEMPORAL_ID)
    // mockReset, not just clearAllMocks: drop any unconsumed *Once values.
    cloudGetTask.mockReset()
    legacyGetTask.mockReset()
    cloudGetTask.mockResolvedValue(task())
    legacyGetTask.mockResolvedValue(task({ store: 'legacy', id: LEGACY_TASK, role: null }))
  })

  const rows = () => db.taskAwait.findMany({ where: { tenantId } })

  describe('an open task', () => {
    it('cloud: registers a waiting row (no poll time) and answers awaiting: true', async () => {
      const res = await awaitTask({}, CLOUD_TASK, { temporalWorkflowId: TEMPORAL_ID })
      expect(res.status).toBe(200)
      expect(data(res.body)).toMatchObject({ id: CLOUD_TASK, status: 'open', awaiting: true })

      const all = await rows()
      expect(all).toHaveLength(1)
      expect(all[0]).toMatchObject({
        executionId: run.id,
        store: 'cloud',
        taskId: CLOUD_TASK,
        orderNum: 500123,
        status: 'waiting',
        attempts: 0,
        nextPollAt: null,
      })
    })

    it('legacy: the row is due for the sweeper poll at once', async () => {
      const before = Date.now()
      const res = await awaitTask({}, LEGACY_TASK, { temporalWorkflowId: TEMPORAL_ID })
      expect(res.status).toBe(200)
      expect(data(res.body)['awaiting']).toBe(true)

      const [row] = await rows()
      expect(row).toMatchObject({ store: 'legacy', taskId: LEGACY_TASK, status: 'waiting' })
      expect(row!.nextPollAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
      expect(row!.nextPollAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
    })

    it('is idempotent per (run, task): a repeat keeps one row', async () => {
      await awaitTask({}, CLOUD_TASK, { temporalWorkflowId: TEMPORAL_ID })
      const again = await awaitTask({}, CLOUD_TASK, { temporalWorkflowId: TEMPORAL_ID })
      expect(again.status).toBe(200)
      expect(await rows()).toHaveLength(1)
    })

    it('re-arms a delivered / abandoned row (the Workflow asks again)', async () => {
      await db.taskAwait.create({
        data: {
          tenantId,
          executionId: run.id,
          store: 'cloud',
          taskId: CLOUD_TASK,
          orderNum: 500123,
          status: 'abandoned',
          attempts: 4,
          lastError: 'NOT_RUNNING',
          deliveredAt: new Date(),
        },
      })
      await awaitTask({}, CLOUD_TASK, { temporalWorkflowId: TEMPORAL_ID })
      const [row] = await rows()
      expect(row).toMatchObject({
        status: 'waiting',
        attempts: 0,
        lastError: null,
        deliveredAt: null,
      })
    })

    it('one run can wait on several tasks; one task can have several waiters', async () => {
      const second = await seedRun(tenantId, lifecycle.id, 'wfl/t/order_lifecycle/o-2')
      await awaitTask({}, CLOUD_TASK, { temporalWorkflowId: TEMPORAL_ID })
      await awaitTask({}, LEGACY_TASK, { temporalWorkflowId: TEMPORAL_ID })
      await awaitTask({}, CLOUD_TASK, { temporalWorkflowId: 'wfl/t/order_lifecycle/o-2' })
      const all = await rows()
      expect(all).toHaveLength(3)
      expect(
        all
          .filter((r) => r.taskId === CLOUD_TASK)
          .map((r) => r.executionId)
          .sort(),
      ).toEqual([run.id, second.id].sort())
    })
  })

  describe('a closed task', () => {
    it('answers awaiting: false at once and registers nothing', async () => {
      cloudGetTask.mockResolvedValue(closed())
      const res = await awaitTask({}, CLOUD_TASK, { temporalWorkflowId: TEMPORAL_ID })
      expect(res.status).toBe(200)
      expect(data(res.body)).toMatchObject({ status: 'closed', reason: 'done', awaiting: false })
      expect(await rows()).toHaveLength(0)
    })

    it("marks this run's earlier waiting row delivered", async () => {
      await awaitTask({}, CLOUD_TASK, { temporalWorkflowId: TEMPORAL_ID })
      cloudGetTask.mockResolvedValue(closed())
      await awaitTask({}, CLOUD_TASK, { temporalWorkflowId: TEMPORAL_ID })
      const [row] = await rows()
      expect(row!.status).toBe('delivered')
      expect(row!.deliveredAt).not.toBeNull()
    })

    it('cloud: a close that lands between the read and the row write is answered here', async () => {
      cloudGetTask.mockResolvedValueOnce(task()).mockResolvedValueOnce(closed())
      const res = await awaitTask({}, CLOUD_TASK, { temporalWorkflowId: TEMPORAL_ID })
      expect(data(res.body)).toMatchObject({ status: 'closed', awaiting: false })
      expect(cloudGetTask).toHaveBeenCalledTimes(2)
      const [row] = await rows()
      expect(row!.status).toBe('delivered')
    })

    it('legacy: one read only (the sweeper polls; no second tunnel call)', async () => {
      await awaitTask({}, LEGACY_TASK, { temporalWorkflowId: TEMPORAL_ID })
      expect(legacyGetTask).toHaveBeenCalledTimes(1)
    })
  })

  describe('which run is waiting', () => {
    it('resolves a manual run before its Temporal id is stamped (wf/<tenant>/<name>/<id>)', async () => {
      const queued = await seedRun(tenantId, lifecycle.id, null, 'QUEUED')
      const res = await awaitTask({}, CLOUD_TASK, {
        temporalWorkflowId: `wf/${tenantId}/order_lifecycle/${queued.id}`,
      })
      expect(res.status).toBe(200)
      const [row] = await rows()
      expect(row!.executionId).toBe(queued.id)
    })

    it("refuses the embedded-id fallback for another workflow's name", async () => {
      const queued = await seedRun(tenantId, lifecycle.id, null, 'QUEUED')
      const res = await awaitTask({}, CLOUD_TASK, {
        temporalWorkflowId: `wf/${tenantId}/other_name/${queued.id}`,
      })
      expect(res.status).toBe(404)
      expect(res.body['code']).toBe('EXECUTION_NOT_OPEN')
    })

    it.each([
      ['an unknown Temporal id', 'wfl/t/order_lifecycle/nope'],
      ['a COMPLETED run', 'wfl/t/order_lifecycle/done'],
      ["another Workflow's run", 'wfl/t/other/o-1'],
      ["another tenant's run", 'wfl/t/order_lifecycle/x-tenant'],
    ])('404 EXECUTION_NOT_OPEN for %s, nothing written', async (_label, temporalWorkflowId) => {
      await seedRun(tenantId, lifecycle.id, 'wfl/t/order_lifecycle/done', 'COMPLETED')
      const other = await seedWorkflow(tenantId, 'other', 'WORKFLOW')
      await seedRun(tenantId, other.id, 'wfl/t/other/o-1')
      const foreign = await seedWorkflow(otherTenantId, 'order_lifecycle', 'WORKFLOW')
      await seedRun(otherTenantId, foreign.id, 'wfl/t/order_lifecycle/x-tenant')

      const res = await awaitTask({}, CLOUD_TASK, { temporalWorkflowId })
      expect(res.status).toBe(404)
      expect(res.body['code']).toBe('EXECUTION_NOT_OPEN')
      expect(cloudGetTask).not.toHaveBeenCalled()
      expect(
        await db.taskAwait.count({ where: { tenantId: { in: [tenantId, otherTenantId] } } }),
      ).toBe(0)
    })

    it("another tenant's token can't reach this tenant's run", async () => {
      const foreign = await seedWorkflow(otherTenantId, 'order_lifecycle', 'WORKFLOW')
      const res = await awaitTask(
        { tid: otherTenantId, client: foreign.runtimeApiClientId! },
        CLOUD_TASK,
        { temporalWorkflowId: TEMPORAL_ID },
      )
      expect(res.status).toBe(404)
      expect(res.body['code']).toBe('EXECUTION_NOT_OPEN')
    })
  })

  describe('who may call', () => {
    it("403 AWAIT_CALLER_NOT_WORKFLOW for an Automation's token", async () => {
      const auto = await seedWorkflow(tenantId, 'send_quote', 'AUTOMATION')
      const res = await awaitTask({ client: auto.runtimeApiClientId! }, CLOUD_TASK, {
        temporalWorkflowId: TEMPORAL_ID,
      })
      expect(res.status).toBe(403)
      expect(res.body['code']).toBe('AWAIT_CALLER_NOT_WORKFLOW')
    })

    it('403 AWAIT_CALLER_NOT_WORKFLOW with no runtime token (a human session)', async () => {
      const res = await awaitTask({ client: undefined }, CLOUD_TASK, {
        temporalWorkflowId: TEMPORAL_ID,
      })
      expect(res.status).toBe(403)
      expect(res.body['code']).toBe('AWAIT_CALLER_NOT_WORKFLOW')
    })

    it('403 from Cedar for a role without ReadTask', async () => {
      const res = await awaitTask({ roles: ['workflow_developer'] }, CLOUD_TASK, {
        temporalWorkflowId: TEMPORAL_ID,
      })
      expect(res.status).toBe(403)
      expect(await rows()).toHaveLength(0)
    })
  })

  describe('the task', () => {
    it('404 TASK_NOT_FOUND for an id of neither store, nothing written', async () => {
      const res = await awaitTask({}, 'task_1_x', { temporalWorkflowId: TEMPORAL_ID })
      expect(res.status).toBe(404)
      expect(res.body['code']).toBe('TASK_NOT_FOUND')
      expect(await rows()).toHaveLength(0)
    })

    it('404 TASK_NOT_FOUND when the store has no such task', async () => {
      cloudGetTask.mockResolvedValue(null)
      const res = await awaitTask({}, CLOUD_TASK, { temporalWorkflowId: TEMPORAL_ID })
      expect(res.status).toBe(404)
      expect(res.body['code']).toBe('TASK_NOT_FOUND')
      expect(await rows()).toHaveLength(0)
    })

    it('400 VALIDATION_ERROR without temporalWorkflowId, or with extra fields', async () => {
      expect((await awaitTask({}, CLOUD_TASK, {})).status).toBe(400)
      expect(
        (await awaitTask({}, CLOUD_TASK, { temporalWorkflowId: TEMPORAL_ID, executionId: 'x' }))
          .status,
      ).toBe(400)
    })
  })
})
