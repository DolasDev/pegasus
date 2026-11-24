/**
 * Integration tests for the task-await sweeper (task queue Phase 3b, D6) on
 * Postgres. Only the outside world is faked: the Temporal signal
 * (signalPlatformExecution) and the legacy task store (the `legacyGateway`
 * seam). The pegII caller is built for real, so the tests prove a legacy poll
 * acts as the awaiting Workflow's runtime service account.
 *
 * Requires a live PostgreSQL database; skipped when DATABASE_URL is not set.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type * as SignalModule from './lib/signal-workflow-execution'
import type { PegiiCaller } from './lib/pegii-request-context'
import type { TaskGateway, TaskRecord } from './gateways/task.gateway'

const { signalPlatformExecution } = vi.hoisted(() => ({ signalPlatformExecution: vi.fn() }))
vi.mock('./lib/signal-workflow-execution', async (importOriginal) => ({
  ...(await importOriginal<typeof SignalModule>()),
  signalPlatformExecution,
}))
vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: class {
    send = vi.fn()
  },
  PutMetricDataCommand: class {
    constructor(public input: unknown) {}
  },
}))

import { db } from './db'
import {
  CLOUD_RECHECK_MS,
  LEGACY_POLL_INTERVAL_MS,
  REDELIVERY_GRACE_MS,
  sweepTaskAwaits,
  type SweepOptions,
} from './lambda-task-sweeper'

const hasDb = Boolean(process.env['DATABASE_URL'])
const SLUG = 'test-task-sweeper'
const SLUG_OTHER = 'test-task-sweeper-other'
let tenantId = ''
let otherTenantId = ''
const root = db as unknown as PrismaClient

/** A Workflow with a real runtime service account (ApiClient acts-as TenantUser). */
async function seedWorkflow(tid: string, opts: { runtimeAccount?: boolean } = {}) {
  const name = 'order_lifecycle'
  let runtimeApiClientId: string | null = null
  let serviceAccountId: string | null = null
  if (opts.runtimeAccount !== false) {
    const svc = await db.tenantUser.create({
      data: {
        tenantId: tid,
        email: `svc-${tid.slice(0, 8)}-${Math.random().toString(36).slice(2)}@svc.invalid`,
        isServiceAccount: true,
        status: 'ACTIVE',
        roleNames: ['workflow_runtime'],
      },
    })
    const client = await db.apiClient.create({
      data: {
        tenantId: tid,
        name: 'wf-runtime-test',
        keyPrefix: 'vnd_test0000',
        keyHash: `hash-${svc.id}`,
        scopes: [],
        createdById: svc.id,
        actsAsUserId: svc.id,
      },
    })
    runtimeApiClientId = client.id
    serviceAccountId = svc.id
  }
  const workflow = await db.workflow.create({
    data: {
      tenantId: tid,
      name,
      version: `1.0.${Math.floor(Math.random() * 1e6)}`,
      kind: 'WORKFLOW',
      artifactKey: `workflows/${tid}/${name}.zip`,
      manifest: { name, version: '1.0.0', entryPoints: ['main:W'], kind: 'workflow' },
      createdByUserId: 'creator-1',
      executable: true,
      artifactSha256: name.padEnd(64, '0'),
      runtimeApiClientId,
      runtimeTokenCiphertext: runtimeApiClientId ? 'ciphertext' : null,
    },
  })
  return { workflow, serviceAccountId }
}

async function seedRun(
  tid: string,
  workflowId: string,
  status: 'RUNNING' | 'COMPLETED' | 'CANCELLED' = 'RUNNING',
) {
  return db.workflowExecution.create({
    data: {
      tenantId: tid,
      workflowId,
      status,
      input: {},
      temporalWorkflowId: `wfl/t/o/${Math.random().toString(36).slice(2)}`,
      temporalRunId: 'run-1',
      queuedAt: new Date(),
      startedAt: new Date(),
      ...(status === 'RUNNING' ? {} : { finishedAt: new Date() }),
    },
  })
}

async function seedAwait(
  tid: string,
  executionId: string,
  over: {
    store?: 'cloud' | 'legacy'
    taskId?: string
    orderNum?: number
    status?: 'waiting' | 'delivered' | 'abandoned'
    nextPollAt?: Date | null
  } = {},
) {
  const store = over.store ?? 'legacy'
  return db.taskAwait.create({
    data: {
      tenantId: tid,
      executionId,
      store,
      taskId: over.taskId ?? '4242',
      orderNum: over.orderNum ?? 500123,
      status: over.status ?? 'waiting',
      nextPollAt:
        over.nextPollAt === undefined ? (store === 'legacy' ? new Date() : null) : over.nextPollAt,
    },
  })
}

async function seedWorkItem(tid: string, status: 'open' | 'done') {
  return db.workItem.create({
    data: {
      tenantId: tid,
      orderNum: 500123,
      taskType: 'confirm-dates',
      title: 'Confirm dates',
      owningRole: 'operations',
      status,
      ...(status === 'done' ? { doneAt: new Date(), closeReason: 'done' } : {}),
    },
  })
}

function legacyTask(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    store: 'legacy',
    id: '4242',
    orderId: '500123',
    taskType: 'Confirm Dates',
    title: 'Confirm dates',
    description: null,
    priority: null,
    dueDate: '2026-11-30',
    assigneeCode: 1196,
    status: 'open',
    reason: null,
    createdByApi: false,
    active: true,
    completedAt: null,
    completedBy: null,
    actualDate: null,
    createdAt: null,
    closedAt: null,
    role: null,
    assigneeUnresolved: null,
    ...over,
  }
}

/** A fake legacy store that records each poll and the identity it acted as. */
function fakeLegacy(list: () => Promise<TaskRecord[] | null>) {
  const polls: Array<{ tenantId: string; orderNumber: string; caller: PegiiCaller }> = []
  const legacyGateway: SweepOptions['legacyGateway'] = async (_tenantDb, tid, callerOf) =>
    ({
      store: 'legacy',
      listOrderTasks: async (orderNumber: string) => {
        polls.push({ tenantId: tid, orderNumber, caller: await callerOf() })
        return list()
      },
    }) as unknown as TaskGateway
  return { polls, legacyGateway }
}

async function wipe(tid: string) {
  await db.taskAwait.deleteMany({ where: { tenantId: tid } })
  await db.workItem.deleteMany({ where: { tenantId: tid } })
  await db.workflowExecution.deleteMany({ where: { tenantId: tid } })
  await db.workflow.deleteMany({ where: { tenantId: tid } })
  await db.apiClient.deleteMany({ where: { tenantId: tid } })
  await db.companyMembership.deleteMany({ where: { tenantId: tid } })
  await db.company.deleteMany({ where: { tenantId: tid } })
  await db.site.deleteMany({ where: { tenantId: tid } })
  await db.tenantUser.deleteMany({ where: { tenantId: tid } })
}

const row = (id: string) => db.taskAwait.findUniqueOrThrow({ where: { id } })
/** A clock past the redelivery grace, so a just-closed WorkItem is due. */
const later = () => new Date(Date.now() + REDELIVERY_GRACE_MS + 60_000)

afterAll(async () => {
  if (!hasDb) return
  for (const t of [tenantId, otherTenantId].filter(Boolean)) await wipe(t).catch(() => undefined)
  await db.$disconnect()
})

describe.skipIf(!hasDb)('task-await sweeper (integration)', () => {
  beforeAll(async () => {
    const upsert = (slug: string) =>
      db.tenant.upsert({ where: { slug }, create: { name: slug, slug }, update: {} })
    tenantId = (await upsert(SLUG)).id
    otherTenantId = (await upsert(SLUG_OTHER)).id
  })

  beforeEach(async () => {
    signalPlatformExecution.mockReset()
    signalPlatformExecution.mockResolvedValue({ outcome: 'SIGNALLED' })
    await wipe(tenantId)
    await wipe(otherTenantId)
  })

  const noLegacy = fakeLegacy(async () => {
    throw new Error('legacy store must not be called')
  }).legacyGateway

  describe('(c) cleanup', () => {
    it('abandons waiting awaiters of ended runs, and nothing else', async () => {
      const { workflow } = await seedWorkflow(tenantId)
      const ended = await seedRun(tenantId, workflow.id, 'COMPLETED')
      const live = await seedRun(tenantId, workflow.id)
      const dead = await seedAwait(tenantId, ended.id, { nextPollAt: later() })
      const alive = await seedAwait(tenantId, live.id, { nextPollAt: later() })
      const settled = await seedAwait(tenantId, ended.id, {
        taskId: '4243',
        status: 'delivered',
        nextPollAt: null,
      })

      const counts = await sweepTaskAwaits({
        onlyTenantIds: [tenantId, otherTenantId],
        db: root,
        legacyGateway: noLegacy,
      })

      expect(counts.abandonedEnded).toBe(1)
      expect(await row(dead.id)).toMatchObject({
        status: 'abandoned',
        lastError: 'EXECUTION_ENDED',
      })
      expect((await row(alive.id)).status).toBe('waiting')
      expect((await row(settled.id)).status).toBe('delivered')
    })
  })

  describe('(a) cloud redelivery', () => {
    it('signals a waiting awaiter whose WorkItem is closed → delivered', async () => {
      const { workflow } = await seedWorkflow(tenantId)
      const run = await seedRun(tenantId, workflow.id)
      const item = await seedWorkItem(tenantId, 'done')
      const awaiter = await seedAwait(tenantId, run.id, { store: 'cloud', taskId: item.id })

      const counts = await sweepTaskAwaits({
        onlyTenantIds: [tenantId, otherTenantId],
        db: root,
        now: later,
        legacyGateway: noLegacy,
      })

      expect(counts.cloud).toEqual({ delivered: 1, abandoned: 0, failed: 0 })
      const [, opts] = signalPlatformExecution.mock.calls[0]!
      expect(opts).toMatchObject({
        signalName: 'pegasus.task_closed',
        execution: { id: run.id },
        args: [expect.objectContaining({ id: item.id, status: 'closed', store: 'cloud' })],
      })
      expect((await row(awaiter.id)).status).toBe('delivered')
    })

    it('leaves a task that closed inside the grace window to its own close', async () => {
      const { workflow } = await seedWorkflow(tenantId)
      const run = await seedRun(tenantId, workflow.id)
      const item = await seedWorkItem(tenantId, 'done')
      const awaiter = await seedAwait(tenantId, run.id, { store: 'cloud', taskId: item.id })

      await sweepTaskAwaits({
        onlyTenantIds: [tenantId, otherTenantId],
        db: root,
        legacyGateway: noLegacy,
      })

      expect(signalPlatformExecution).not.toHaveBeenCalled()
      expect((await row(awaiter.id)).status).toBe('waiting')
    })

    it('an open task is re-checked one interval later (open waits rotate, never starve)', async () => {
      const { workflow } = await seedWorkflow(tenantId)
      const run = await seedRun(tenantId, workflow.id)
      const item = await seedWorkItem(tenantId, 'open')
      const awaiter = await seedAwait(tenantId, run.id, { store: 'cloud', taskId: item.id })
      const fixedNow = later()

      const counts = await sweepTaskAwaits({
        onlyTenantIds: [tenantId, otherTenantId],
        db: root,
        now: () => fixedNow,
        legacyGateway: noLegacy,
      })

      expect(counts.cloudDeferred).toBe(1)
      expect((await row(awaiter.id)).nextPollAt!.getTime()).toBe(
        fixedNow.getTime() + CLOUD_RECHECK_MS,
      )
      expect(signalPlatformExecution).not.toHaveBeenCalled()
    })

    it('skips a cloud awaiter that is not due yet', async () => {
      const { workflow } = await seedWorkflow(tenantId)
      const run = await seedRun(tenantId, workflow.id)
      const item = await seedWorkItem(tenantId, 'done')
      const awaiter = await seedAwait(tenantId, run.id, {
        store: 'cloud',
        taskId: item.id,
        nextPollAt: new Date(Date.now() + 60 * 60_000),
      })

      await sweepTaskAwaits({
        onlyTenantIds: [tenantId, otherTenantId],
        db: root,
        now: later,
        legacyGateway: noLegacy,
      })
      expect(signalPlatformExecution).not.toHaveBeenCalled()
      expect((await row(awaiter.id)).status).toBe('waiting')
    })

    it('never signals for an open task', async () => {
      const { workflow } = await seedWorkflow(tenantId)
      const run = await seedRun(tenantId, workflow.id)
      const item = await seedWorkItem(tenantId, 'open')
      await seedAwait(tenantId, run.id, { store: 'cloud', taskId: item.id })

      await sweepTaskAwaits({
        onlyTenantIds: [tenantId, otherTenantId],
        db: root,
        now: later,
        legacyGateway: noLegacy,
      })
      expect(signalPlatformExecution).not.toHaveBeenCalled()
    })

    it('a failed redelivery stays waiting with attempts + 1', async () => {
      signalPlatformExecution.mockResolvedValue({ outcome: 'SIGNAL_FAILED', message: 'down' })
      const { workflow } = await seedWorkflow(tenantId)
      const run = await seedRun(tenantId, workflow.id)
      const item = await seedWorkItem(tenantId, 'done')
      const awaiter = await seedAwait(tenantId, run.id, { store: 'cloud', taskId: item.id })

      const counts = await sweepTaskAwaits({
        onlyTenantIds: [tenantId, otherTenantId],
        db: root,
        now: later,
        legacyGateway: noLegacy,
      })

      expect(counts.cloud.failed).toBe(1)
      expect(await row(awaiter.id)).toMatchObject({ status: 'waiting', attempts: 1 })
    })

    it("never joins a task id to another tenant's WorkItem", async () => {
      const { workflow } = await seedWorkflow(otherTenantId)
      const run = await seedRun(otherTenantId, workflow.id)
      const item = await seedWorkItem(tenantId, 'done') // tenant A's closed task
      const awaiter = await seedAwait(otherTenantId, run.id, { store: 'cloud', taskId: item.id })

      await sweepTaskAwaits({
        onlyTenantIds: [tenantId, otherTenantId],
        db: root,
        now: later,
        legacyGateway: noLegacy,
      })

      // Looked up in ITS tenant, tenant A's closed task doesn't exist: never
      // signalled, and the wait is ended as unknown.
      expect(signalPlatformExecution).not.toHaveBeenCalled()
      expect(await row(awaiter.id)).toMatchObject({
        status: 'abandoned',
        lastError: 'TASK_NOT_FOUND',
      })
    })
  })

  describe('(b) legacy poll', () => {
    it("delivers a closed task, polling as the awaiting Workflow's runtime service account", async () => {
      const { workflow, serviceAccountId } = await seedWorkflow(tenantId)
      const run = await seedRun(tenantId, workflow.id)
      const awaiter = await seedAwait(tenantId, run.id)
      const closed = legacyTask({ status: 'closed', reason: 'Closed by MoveManager' })
      const legacy = fakeLegacy(async () => [closed])

      const counts = await sweepTaskAwaits({
        onlyTenantIds: [tenantId, otherTenantId],
        db: root,
        legacyGateway: legacy.legacyGateway,
      })

      expect(counts.legacy.delivered).toBe(1)
      expect(legacy.polls).toHaveLength(1)
      expect(legacy.polls[0]).toMatchObject({ tenantId, orderNumber: '500123' })
      expect(legacy.polls[0]!.caller.principal).toMatchObject({
        tenantUserId: serviceAccountId,
        isServiceAccount: true,
      })
      expect(legacy.polls[0]!.caller.tenantId).toBe(tenantId)
      const [, opts] = signalPlatformExecution.mock.calls[0]!
      expect(opts.args[0]).toMatchObject({ id: '4242', status: 'closed', store: 'legacy' })
      expect((await row(awaiter.id)).status).toBe('delivered')
    })

    it('an open task is polled again one interval later', async () => {
      const { workflow } = await seedWorkflow(tenantId)
      const run = await seedRun(tenantId, workflow.id)
      const awaiter = await seedAwait(tenantId, run.id)
      const fixedNow = new Date()
      const legacy = fakeLegacy(async () => [legacyTask()])

      const counts = await sweepTaskAwaits({
        onlyTenantIds: [tenantId, otherTenantId],
        db: root,
        now: () => fixedNow,
        legacyGateway: legacy.legacyGateway,
      })

      expect(counts.legacy.deferred).toBe(1)
      const after = await row(awaiter.id)
      expect(after.status).toBe('waiting')
      expect(after.nextPollAt!.getTime()).toBe(fixedNow.getTime() + LEGACY_POLL_INTERVAL_MS)
      expect(signalPlatformExecution).not.toHaveBeenCalled()
    })

    it('one poll per (tenant, order), whatever the number of waiters', async () => {
      const { workflow } = await seedWorkflow(tenantId)
      const a = await seedRun(tenantId, workflow.id)
      const b = await seedRun(tenantId, workflow.id)
      await seedAwait(tenantId, a.id, { taskId: '4242' })
      await seedAwait(tenantId, b.id, { taskId: '4242' })
      await seedAwait(tenantId, a.id, { taskId: '4243' })
      await seedAwait(tenantId, a.id, { taskId: '9000', orderNum: 500999 })
      const legacy = fakeLegacy(async () => [
        legacyTask({ status: 'closed' }),
        legacyTask({ id: '4243' }),
        legacyTask({ id: '9000', orderId: '500999' }),
      ])

      const counts = await sweepTaskAwaits({
        onlyTenantIds: [tenantId, otherTenantId],
        db: root,
        legacyGateway: legacy.legacyGateway,
      })

      expect(legacy.polls.map((p) => p.orderNumber).sort()).toEqual(['500123', '500999'])
      expect(counts.legacy).toMatchObject({ delivered: 2, deferred: 2 })
    })

    it('does not poll an awaiter that is not due yet', async () => {
      const { workflow } = await seedWorkflow(tenantId)
      const run = await seedRun(tenantId, workflow.id)
      await seedAwait(tenantId, run.id, { nextPollAt: new Date(Date.now() + 60_000) })
      const legacy = fakeLegacy(async () => [legacyTask({ status: 'closed' })])

      await sweepTaskAwaits({
        onlyTenantIds: [tenantId, otherTenantId],
        db: root,
        legacyGateway: legacy.legacyGateway,
      })
      expect(legacy.polls).toHaveLength(0)
    })

    it.each([
      ['the task is gone from its order', async () => [legacyTask({ id: '1' })], 'TASK_NOT_FOUND'],
      ['the order is gone', async () => null, 'ORDER_NOT_FOUND'],
    ])('abandons when %s', async (_label, list, reason) => {
      const { workflow } = await seedWorkflow(tenantId)
      const run = await seedRun(tenantId, workflow.id)
      const awaiter = await seedAwait(tenantId, run.id)

      await sweepTaskAwaits({
        onlyTenantIds: [tenantId, otherTenantId],
        db: root,
        legacyGateway: fakeLegacy(list).legacyGateway,
      })
      expect(await row(awaiter.id)).toMatchObject({ status: 'abandoned', lastError: reason })
    })

    it('a failed poll counts an attempt and waits one interval', async () => {
      const { workflow } = await seedWorkflow(tenantId)
      const run = await seedRun(tenantId, workflow.id)
      const awaiter = await seedAwait(tenantId, run.id)
      const fixedNow = new Date()
      const legacy = fakeLegacy(async () => {
        throw new Error('tunnel down')
      })

      const counts = await sweepTaskAwaits({
        onlyTenantIds: [tenantId, otherTenantId],
        db: root,
        now: () => fixedNow,
        legacyGateway: legacy.legacyGateway,
      })

      expect(counts.legacyPollFailures).toBe(1)
      const after = await row(awaiter.id)
      expect(after).toMatchObject({
        status: 'waiting',
        attempts: 1,
        lastError: 'POLL_FAILED: tunnel down',
      })
      expect(after.nextPollAt!.getTime()).toBe(fixedNow.getTime() + LEGACY_POLL_INTERVAL_MS)
    })

    it('never polls under a guessed identity: no runtime account → RUNTIME_ACCOUNT_UNRESOLVED', async () => {
      const { workflow } = await seedWorkflow(tenantId, { runtimeAccount: false })
      const run = await seedRun(tenantId, workflow.id)
      const awaiter = await seedAwait(tenantId, run.id)
      const legacy = fakeLegacy(async () => [legacyTask({ status: 'closed' })])

      await sweepTaskAwaits({
        onlyTenantIds: [tenantId, otherTenantId],
        db: root,
        legacyGateway: legacy.legacyGateway,
      })

      expect(legacy.polls).toHaveLength(0)
      expect(await row(awaiter.id)).toMatchObject({
        status: 'waiting',
        attempts: 1,
        lastError: 'RUNTIME_ACCOUNT_UNRESOLVED',
      })
    })

    it('ignores a runtime ApiClient that belongs to another tenant', async () => {
      const foreign = await seedWorkflow(otherTenantId)
      const { workflow } = await seedWorkflow(tenantId, { runtimeAccount: false })
      await db.workflow.update({
        where: { id: workflow.id },
        data: { runtimeApiClientId: foreign.workflow.runtimeApiClientId },
      })
      const run = await seedRun(tenantId, workflow.id)
      const awaiter = await seedAwait(tenantId, run.id)
      const legacy = fakeLegacy(async () => [legacyTask({ status: 'closed' })])

      await sweepTaskAwaits({
        onlyTenantIds: [tenantId, otherTenantId],
        db: root,
        legacyGateway: legacy.legacyGateway,
      })

      expect(legacy.polls).toHaveLength(0)
      expect((await row(awaiter.id)).lastError).toBe('RUNTIME_ACCOUNT_UNRESOLVED')
    })
  })

  it('onlyTenantIds keeps every lane to those tenants', async () => {
    const mine = await seedWorkflow(tenantId)
    const theirs = await seedWorkflow(otherTenantId)
    const myEnded = await seedAwait(
      tenantId,
      (await seedRun(tenantId, mine.workflow.id, 'COMPLETED')).id,
    )
    const theirEnded = await seedAwait(
      otherTenantId,
      (await seedRun(otherTenantId, theirs.workflow.id, 'COMPLETED')).id,
    )
    const theirRun = await seedRun(otherTenantId, theirs.workflow.id)
    const theirItem = await seedWorkItem(otherTenantId, 'done')
    const theirCloud = await seedAwait(otherTenantId, theirRun.id, {
      store: 'cloud',
      taskId: theirItem.id,
    })
    const theirLegacy = await seedAwait(otherTenantId, theirRun.id)
    const legacy = fakeLegacy(async () => [legacyTask({ status: 'closed' })])

    await sweepTaskAwaits({
      onlyTenantIds: [tenantId],
      db: root,
      now: later,
      legacyGateway: legacy.legacyGateway,
    })

    expect((await row(myEnded.id)).status).toBe('abandoned')
    expect((await row(theirEnded.id)).status).toBe('waiting')
    expect((await row(theirCloud.id)).status).toBe('waiting')
    expect((await row(theirLegacy.id)).status).toBe('waiting')
    expect(legacy.polls).toHaveLength(0)
    expect(signalPlatformExecution).not.toHaveBeenCalled()
  })

  it('stops starting new work once over its time budget', async () => {
    const { workflow } = await seedWorkflow(tenantId)
    const run = await seedRun(tenantId, workflow.id)
    await seedAwait(tenantId, run.id)
    const legacy = fakeLegacy(async () => [legacyTask({ status: 'closed' })])

    // A negative budget is spent before the first order starts.
    const counts = await sweepTaskAwaits({
      onlyTenantIds: [tenantId, otherTenantId],
      db: root,
      budgetMs: -1,
      legacyGateway: legacy.legacyGateway,
    })

    expect(counts.budgetExhausted).toBe(true)
    expect(legacy.polls).toHaveLength(0)
  })
})
