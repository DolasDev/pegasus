/**
 * Cloud task store behaviour beyond the shared contract
 * (task-gateway.contract.test.ts): roles and assignees, the guardrail-2
 * refusals, tenant isolation, and the order check's cost rules.
 *
 * Runs through the tenant-scoped client production uses. Requires a live
 * PostgreSQL database; skipped automatically when DATABASE_URL is not set.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type { PrismaClient, WorkItem } from '@prisma/client'
import { db } from '../../db'
import { createTenantDb } from '../../lib/prisma'
import { createCloudTaskGateway, workItemToRecord } from '../cloud-task.gateway'
import { createPegiiTaskGateway } from '../pegii-task.gateway'
import { TaskStoreError, type TaskCreateInput } from '../task.gateway'
import type { PegiiApiClient } from '../../lib/pegii-api-client'

const hasDb = Boolean(process.env['DATABASE_URL'])
const SLUG_A = 'test-cloud-task-gateway-a'
const SLUG_B = 'test-cloud-task-gateway-b'
let tenantA = ''
let tenantB = ''
let userA = ''

const scoped = (tenantId: string) =>
  createTenantDb(db as unknown as PrismaClient, tenantId) as unknown as PrismaClient

const input = (over: Partial<TaskCreateInput> = {}): TaskCreateInput => ({
  taskType: 'Confirm Actuals',
  title: 'Confirm actuals with PVO',
  role: 'operations',
  ...over,
})

beforeAll(async () => {
  if (!hasDb) return
  const [a, b] = await Promise.all([
    db.tenant.upsert({
      where: { slug: SLUG_A },
      create: { name: 'Test Tenant (cloud tasks A)', slug: SLUG_A },
      update: {},
    }),
    db.tenant.upsert({
      where: { slug: SLUG_B },
      create: { name: 'Test Tenant (cloud tasks B)', slug: SLUG_B },
      update: {},
    }),
  ])
  tenantA = a.id
  tenantB = b.id
  const user = await db.tenantUser.upsert({
    where: { tenantId_email: { tenantId: tenantA, email: 'dispatcher@cloud-task.test' } },
    create: { tenantId: tenantA, email: 'dispatcher@cloud-task.test', roleNames: [] },
    update: {},
  })
  userA = user.id
})

beforeEach(async () => {
  if (!hasDb) return
  await db.workItem.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } })
})

afterAll(async () => {
  if (!hasDb) return
  await db.workItem
    .deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } })
    .catch(() => undefined)
  await db.$disconnect()
})

describe.skipIf(!hasDb)('createCloudTaskGateway', () => {
  it('records the role, the resolved assignee and an unresolved reason', async () => {
    const gw = createCloudTaskGateway({ db: scoped(tenantA), tenantId: tenantA })

    const assigned = await gw.createTask(
      '490317',
      input({ assignee: { userId: userA, employeeCode: 1196, unresolved: null } }),
    )
    const unresolved = await gw.createTask(
      '490317',
      input({ assignee: { userId: null, employeeCode: null, unresolved: 'NO_DISPATCHER' } }),
    )
    if (!assigned.found || !unresolved.found) throw new Error('unreachable')

    expect(assigned.task).toMatchObject({
      role: 'operations',
      assigneeCode: 1196,
      assigneeUnresolved: null,
      dueDate: null,
      priority: 'normal',
    })
    expect(unresolved.task).toMatchObject({
      assigneeCode: null,
      assigneeUnresolved: 'NO_DISPATCHER',
    })
    const row = await db.workItem.findUniqueOrThrow({ where: { id: assigned.task.id } })
    expect(row.assigneeUserId).toBe(userA)
  })

  it('refuses a MoveManager assigneeCode loudly (guardrail 2)', async () => {
    const gw = createCloudTaskGateway({ db: scoped(tenantA), tenantId: tenantA })

    const err = await gw.createTask('490317', input({ assigneeCode: 8121 })).catch((e) => e)

    expect(err).toBeInstanceOf(TaskStoreError)
    expect(err).toMatchObject({ code: 'UNSUPPORTED_ON_CLOUD_STORE', status: 400 })
    expect(await db.workItem.count({ where: { tenantId: tenantA } })).toBe(0)
  })

  it('a role-less create is a routing bug, never a silent row', async () => {
    const gw = createCloudTaskGateway({ db: scoped(tenantA), tenantId: tenantA })
    const { role: _role, ...noRole } = input()

    await expect(gw.createTask('490317', noRole)).rejects.toThrow(/requires a role/)
  })

  it('checks the order once per NEW create — not on a replay, not on reads', async () => {
    const orderExists = vi.fn().mockResolvedValue(true)
    const gw = createCloudTaskGateway({ db: scoped(tenantA), tenantId: tenantA, orderExists })

    const first = await gw.createTask('490317', input({ idempotencyKey: 'once' }))
    await gw.createTask('490317', input({ idempotencyKey: 'once' }))
    if (!first.found) throw new Error('unreachable')
    await gw.getTask(first.task.id)
    await gw.listOrderTasks('490317')

    expect(orderExists).toHaveBeenCalledTimes(1)
    expect(orderExists).toHaveBeenCalledWith(490317)
  })

  it('without an order check (no pegII target) any well-formed order is accepted', async () => {
    const gw = createCloudTaskGateway({ db: scoped(tenantA), tenantId: tenantA })
    expect(await gw.createTask('123', input())).toMatchObject({ found: true })
  })

  it('records who closed it and when', async () => {
    const at = new Date('2026-11-21T15:00:00Z')
    const gw = createCloudTaskGateway({
      db: scoped(tenantA),
      tenantId: tenantA,
      actorUserId: userA,
      now: () => at,
    })
    const created = await gw.createTask('490317', input())
    if (!created.found) throw new Error('unreachable')

    const closed = await gw.closeTask(created.task.id, 'done')

    expect(closed?.task).toMatchObject({
      completedAt: at.toISOString(),
      closedAt: at.toISOString(),
    })
    const row = await db.workItem.findUniqueOrThrow({ where: { id: created.task.id } })
    expect(row).toMatchObject({ status: 'done', closedByUserId: userA, closeReason: 'done' })
  })

  it('a blocked task is still open, and closing it finishes it', async () => {
    const gw = createCloudTaskGateway({ db: scoped(tenantA), tenantId: tenantA })
    const created = await gw.createTask('490317', input())
    if (!created.found) throw new Error('unreachable')
    await db.workItem.update({
      where: { id: created.task.id },
      data: { status: 'blocked', blockedAt: new Date(), blockReason: 'no access' },
    })

    expect((await gw.getTask(created.task.id))?.status).toBe('open')
    expect(await gw.closeTask(created.task.id, null)).toMatchObject({
      alreadyClosed: false,
      task: { status: 'closed' },
    })
  })

  it("never shows, closes or replays another tenant's task", async () => {
    const a = createCloudTaskGateway({ db: scoped(tenantA), tenantId: tenantA })
    const b = createCloudTaskGateway({ db: scoped(tenantB), tenantId: tenantB })
    const created = await a.createTask('490317', input({ idempotencyKey: 'shared-key' }))
    if (!created.found) throw new Error('unreachable')

    expect(await b.getTask(created.task.id)).toBeNull()
    expect(await b.closeTask(created.task.id, null)).toBeNull()
    expect(await b.listOrderTasks('490317')).toEqual([])
    expect((await b.searchTasks({ taskType: 'Confirm Actuals' })).items).toEqual([])
    // The same key in another tenant is a different task, not a replay or a 409.
    const other = await b.createTask('490317', input({ idempotencyKey: 'shared-key', title: 'x' }))
    expect(other).toMatchObject({ found: true, alreadyExists: false })
    expect((await a.getTask(created.task.id))?.status).toBe('open')
  })

  it('a cursor it did not issue is a 400 INVALID_CURSOR', async () => {
    const gw = createCloudTaskGateway({ db: scoped(tenantA), tenantId: tenantA })

    await expect(gw.searchTasks({ taskType: 'x', cursor: 'not-a-cursor' })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
  })
})

describe('workItemToRecord', () => {
  const row = (over: Partial<WorkItem> = {}): WorkItem => ({
    id: '00000000-0000-4000-8000-000000000001',
    tenantId: 't',
    orderNum: 490317,
    taskType: 'T',
    title: 'Title',
    description: null,
    priority: 'high',
    owningRole: 'coordinator',
    assigneeUserId: null,
    assigneeEmployeeCode: null,
    assigneeUnresolved: null,
    status: 'open',
    dueDate: new Date('2026-12-01T00:00:00Z'),
    dedupKey: null,
    requestHash: null,
    definitionKey: null,
    definitionVersion: null,
    closeReason: null,
    closedByUserId: null,
    blockedAt: null,
    blockReason: null,
    awaitingExecutionId: null,
    createdAt: new Date('2026-11-21T10:00:00Z'),
    updatedAt: new Date('2026-11-21T10:00:00Z'),
    doneAt: null,
    cancelledAt: null,
    ...over,
  })

  it('maps a cancelled task to closed, with closedAt but no completedAt', () => {
    const at = new Date('2026-11-22T09:00:00Z')
    expect(workItemToRecord(row({ status: 'cancelled', cancelledAt: at }))).toMatchObject({
      store: 'cloud',
      status: 'closed',
      completedAt: null,
      closedAt: at.toISOString(),
      dueDate: '2026-12-01',
      orderId: '490317',
      role: 'coordinator',
    })
  })
})

describe('legacy store: dueDate', () => {
  it('a legacy create without dueDate is DUE_DATE_REQUIRED, before reaching the site', async () => {
    const post = vi.fn()
    const gw = createPegiiTaskGateway({
      tenantId: 't',
      baseUrl: 'https://pegii.test',
      client: { post } as unknown as PegiiApiClient,
      requireCapabilities: async () => undefined,
    })
    const { dueDate: _d, ...noDue } = input()

    await expect(gw.createTask('490317', noDue)).rejects.toMatchObject({
      code: 'DUE_DATE_REQUIRED',
      status: 400,
    })
    expect(post).not.toHaveBeenCalled()
  })
})
