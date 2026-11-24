/**
 * Integration tests for delivering a closed task to its waiters (task queue
 * Phase 3b, D5): lib/task-await-delivery.ts on Postgres, plus the cloud close
 * end to end through the factory-built gateway (whose `onClosed` is wired to
 * it). Only the Temporal signal is mocked (signalPlatformExecution).
 *
 * Requires a live PostgreSQL database; skipped when DATABASE_URL is not set.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type * as SignalModule from './signal-workflow-execution'

const { signalPlatformExecution } = vi.hoisted(() => ({ signalPlatformExecution: vi.fn() }))
vi.mock('./signal-workflow-execution', async (importOriginal) => ({
  ...(await importOriginal<typeof SignalModule>()),
  signalPlatformExecution,
}))

import { db } from '../db'
import { createTenantDb } from './prisma'
import { deliverTaskClosed, notifyTaskWaiters } from './task-await-delivery'
import { toTaskResponse } from './task-response'
import { workItemToRecord } from '../gateways/cloud-task.gateway'
import { resolveCloudTaskGateway } from '../gateways/task-gateway.factory'
import type { TaskRecord } from '../gateways/task.gateway'

const hasDb = Boolean(process.env['DATABASE_URL'])
const SLUG = 'test-task-await-delivery'
const SLUG_OTHER = 'test-task-await-delivery-other'
let tenantId = ''
let otherTenantId = ''

const scoped = (tid: string) =>
  createTenantDb(db as unknown as PrismaClient, tid) as unknown as PrismaClient

async function seedRun(tid: string, temporalWorkflowId: string) {
  const name = 'order_lifecycle'
  const workflow =
    (await db.workflow.findFirst({ where: { tenantId: tid, name } })) ??
    (await db.workflow.create({
      data: {
        tenantId: tid,
        name,
        version: '1.0.0',
        kind: 'WORKFLOW',
        artifactKey: `workflows/${tid}/${name}/1.0.0.zip`,
        manifest: { name, version: '1.0.0', entryPoints: ['main:W'], kind: 'workflow' },
        createdByUserId: 'creator-1',
        executable: true,
        artifactSha256: name.padEnd(64, '0'),
        runtimeApiClientId: `client-${tid.slice(0, 8)}-${name}`,
        runtimeTokenCiphertext: 'ciphertext',
      },
    }))
  const execution = await db.workflowExecution.create({
    data: {
      tenantId: tid,
      workflowId: workflow.id,
      status: 'RUNNING',
      input: {},
      temporalWorkflowId,
      temporalRunId: 'run-1',
      queuedAt: new Date(),
      startedAt: new Date(),
    },
  })
  return { workflow, execution }
}

async function seedTask(tid: string, status: 'open' | 'done' = 'open') {
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

async function seedAwait(
  tid: string,
  executionId: string,
  taskId: string,
  status: 'waiting' | 'delivered' | 'abandoned' = 'waiting',
) {
  return db.taskAwait.create({
    data: { tenantId: tid, executionId, store: 'cloud', taskId, orderNum: 500123, status },
  })
}

async function wipe(tid: string) {
  await db.taskAwait.deleteMany({ where: { tenantId: tid } })
  await db.workItem.deleteMany({ where: { tenantId: tid } })
  await db.workflowExecution.deleteMany({ where: { tenantId: tid } })
  await db.workflow.deleteMany({ where: { tenantId: tid } })
}

const closedRecord = async (id: string): Promise<TaskRecord> =>
  workItemToRecord(await db.workItem.findUniqueOrThrow({ where: { id } }))

afterAll(async () => {
  if (!hasDb) return
  for (const t of [tenantId, otherTenantId].filter(Boolean)) await wipe(t).catch(() => undefined)
  await db.$disconnect()
})

describe.skipIf(!hasDb)('task await delivery (integration)', () => {
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

  const row = (id: string) => db.taskAwait.findUniqueOrThrow({ where: { id } })

  describe('deliverTaskClosed', () => {
    it('signals pegasus.task_closed with the task in its wire shape → delivered', async () => {
      const { workflow, execution } = await seedRun(tenantId, 'wfl/t/o/1')
      const task = await seedTask(tenantId, 'done')
      const awaiter = await seedAwait(tenantId, execution.id, task.id)
      const record = await closedRecord(task.id)

      const outcome = await deliverTaskClosed(scoped(tenantId), tenantId, awaiter, record)

      expect(outcome).toBe('delivered')
      expect(signalPlatformExecution).toHaveBeenCalledTimes(1)
      const [, opts] = signalPlatformExecution.mock.calls[0]!
      expect(opts).toMatchObject({
        signalName: 'pegasus.task_closed',
        args: [toTaskResponse(record)],
        execution: { id: execution.id },
        workflow: { id: workflow.id, kind: 'WORKFLOW' },
      })
      expect(await row(awaiter.id)).toMatchObject({ status: 'delivered', nextPollAt: null })
      expect((await row(awaiter.id)).deliveredAt).not.toBeNull()
    })

    it.each(['TERMINAL', 'NOT_RUNNING', 'NOT_DURABLE'] as const)(
      '%s → abandoned, the outcome kept as lastError',
      async (outcome) => {
        signalPlatformExecution.mockResolvedValue({ outcome })
        const { execution } = await seedRun(tenantId, 'wfl/t/o/1')
        const task = await seedTask(tenantId, 'done')
        const awaiter = await seedAwait(tenantId, execution.id, task.id)

        expect(
          await deliverTaskClosed(scoped(tenantId), tenantId, awaiter, await closedRecord(task.id)),
        ).toBe('abandoned')
        expect(await row(awaiter.id)).toMatchObject({ status: 'abandoned', lastError: outcome })
      },
    )

    it.each([
      [
        { outcome: 'SIGNAL_FAILED', message: 'connection reset' },
        /SIGNAL_FAILED: connection reset/,
      ],
      [{ outcome: 'NOT_STARTED' }, /NOT_STARTED/],
    ])('%o → stays waiting, attempts + 1', async (result, lastError) => {
      signalPlatformExecution.mockResolvedValue(result)
      const { execution } = await seedRun(tenantId, 'wfl/t/o/1')
      const task = await seedTask(tenantId, 'done')
      const awaiter = await seedAwait(tenantId, execution.id, task.id)

      expect(
        await deliverTaskClosed(scoped(tenantId), tenantId, awaiter, await closedRecord(task.id)),
      ).toBe('failed')
      const after = await row(awaiter.id)
      expect(after.status).toBe('waiting')
      expect(after.attempts).toBe(1)
      expect(after.lastError).toMatch(lastError)
    })

    it('a throwing signal is a failure, never an exception', async () => {
      signalPlatformExecution.mockRejectedValue(new Error('boom'))
      const { execution } = await seedRun(tenantId, 'wfl/t/o/1')
      const task = await seedTask(tenantId, 'done')
      const awaiter = await seedAwait(tenantId, execution.id, task.id)

      await expect(
        deliverTaskClosed(scoped(tenantId), tenantId, awaiter, await closedRecord(task.id)),
      ).resolves.toBe('failed')
      expect(await row(awaiter.id)).toMatchObject({
        status: 'waiting',
        attempts: 1,
        lastError: 'ERROR: boom',
      })
    })

    it('never regresses a row another delivery already moved on', async () => {
      const { execution } = await seedRun(tenantId, 'wfl/t/o/1')
      const task = await seedTask(tenantId, 'done')
      const awaiter = await seedAwait(tenantId, execution.id, task.id, 'abandoned')

      await deliverTaskClosed(scoped(tenantId), tenantId, awaiter, await closedRecord(task.id))
      expect((await row(awaiter.id)).status).toBe('abandoned')
    })
  })

  describe('notifyTaskWaiters', () => {
    it("signals only this task's waiting rows in this tenant", async () => {
      const a = await seedRun(tenantId, 'wfl/t/o/1')
      const b = await seedRun(tenantId, 'wfl/t/o/2')
      const task = await seedTask(tenantId, 'done')
      const otherTask = await seedTask(tenantId, 'open')
      const w1 = await seedAwait(tenantId, a.execution.id, task.id)
      const w2 = await seedAwait(tenantId, b.execution.id, task.id)
      const done = await seedAwait(tenantId, a.execution.id, otherTask.id, 'waiting')
      // Same task id string in another tenant: must not be touched.
      const foreign = await seedRun(otherTenantId, 'wfl/t/o/1')
      const foreignWait = await seedAwait(otherTenantId, foreign.execution.id, task.id)

      const tally = await notifyTaskWaiters(scoped(tenantId), tenantId, await closedRecord(task.id))

      expect(tally).toEqual({ delivered: 2, abandoned: 0, failed: 0 })
      expect((await row(w1.id)).status).toBe('delivered')
      expect((await row(w2.id)).status).toBe('delivered')
      expect((await row(done.id)).status).toBe('waiting')
      expect((await row(foreignWait.id)).status).toBe('waiting')
    })

    it('one failing waiter does not stop the rest', async () => {
      signalPlatformExecution
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ outcome: 'SIGNALLED' })
      const a = await seedRun(tenantId, 'wfl/t/o/1')
      const b = await seedRun(tenantId, 'wfl/t/o/2')
      const task = await seedTask(tenantId, 'done')
      await seedAwait(tenantId, a.execution.id, task.id)
      await seedAwait(tenantId, b.execution.id, task.id)

      const tally = await notifyTaskWaiters(scoped(tenantId), tenantId, await closedRecord(task.id))
      expect(tally).toEqual({ delivered: 1, abandoned: 0, failed: 1 })
    })

    it('an open task signals nobody', async () => {
      const a = await seedRun(tenantId, 'wfl/t/o/1')
      const task = await seedTask(tenantId, 'open')
      await seedAwait(tenantId, a.execution.id, task.id)

      const tally = await notifyTaskWaiters(scoped(tenantId), tenantId, await closedRecord(task.id))
      expect(tally).toEqual({ delivered: 0, abandoned: 0, failed: 0 })
      expect(signalPlatformExecution).not.toHaveBeenCalled()
    })
  })

  describe('a cloud close, end to end (factory gateway)', () => {
    it('closing the task signals its waiter and marks it delivered', async () => {
      const { execution } = await seedRun(tenantId, 'wfl/t/o/1')
      const task = await seedTask(tenantId, 'open')
      const awaiter = await seedAwait(tenantId, execution.id, task.id)
      const gw = resolveCloudTaskGateway({ db: scoped(tenantId), tenantId })

      const result = await gw.closeTask(task.id, 'customer confirmed')

      expect(result).toMatchObject({ alreadyClosed: false, task: { status: 'closed' } })
      expect(signalPlatformExecution).toHaveBeenCalledTimes(1)
      const [, opts] = signalPlatformExecution.mock.calls[0]!
      expect(opts.args[0]).toMatchObject({
        id: task.id,
        status: 'closed',
        reason: 'customer confirmed',
        store: 'cloud',
      })
      expect((await row(awaiter.id)).status).toBe('delivered')
    })

    it('a failed signal leaves the waiter waiting and the close succeeds', async () => {
      signalPlatformExecution.mockResolvedValue({ outcome: 'SIGNAL_FAILED', message: 'down' })
      const { execution } = await seedRun(tenantId, 'wfl/t/o/1')
      const task = await seedTask(tenantId, 'open')
      const awaiter = await seedAwait(tenantId, execution.id, task.id)

      const result = await resolveCloudTaskGateway({ db: scoped(tenantId), tenantId }).closeTask(
        task.id,
        null,
      )

      expect(result).toMatchObject({ alreadyClosed: false })
      expect(await row(awaiter.id)).toMatchObject({ status: 'waiting', attempts: 1 })
    })

    it('a repeat close signals nobody', async () => {
      const { execution } = await seedRun(tenantId, 'wfl/t/o/1')
      const task = await seedTask(tenantId, 'done')
      await seedAwait(tenantId, execution.id, task.id)

      const result = await resolveCloudTaskGateway({ db: scoped(tenantId), tenantId }).closeTask(
        task.id,
        null,
      )
      expect(result).toMatchObject({ alreadyClosed: true })
      expect(signalPlatformExecution).not.toHaveBeenCalled()
    })
  })
})
