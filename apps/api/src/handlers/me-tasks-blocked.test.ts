/**
 * Integration tests for Blocked (andon) on the driver To Do: PUT
 * /me/tasks/state { blocked } against Postgres, through the tenant-scoped
 * client. The legacy itinerary read is mocked (one longhaul PACK act), so the
 * task the driver blocks is a real computed task.
 *
 * Requires a live PostgreSQL database; skipped when DATABASE_URL is not set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'

vi.mock('../lib/chat-access', () => ({ legacyConnectionString: vi.fn() }))
vi.mock('../lib/itinerary/fetch', () => ({ fetchItinerary: vi.fn() }))
vi.mock('../lib/push-forward-invoke', () => ({ kickPushForwarder: vi.fn() }))

import type { AppEnv } from '../types'
import { db } from '../db'
import { createTenantDb } from '../lib/prisma'
import { registerTestErrorHandler } from '../test-helpers'
import { legacyConnectionString } from '../lib/chat-access'
import { fetchItinerary } from '../lib/itinerary/fetch'
import { kickPushForwarder } from '../lib/push-forward-invoke'
import { meTasksHandler } from './me-tasks'

const hasDb = Boolean(process.env['DATABASE_URL'])
const cs = legacyConnectionString as unknown as Mock
const fetchMock = fetchItinerary as unknown as Mock
const kick = kickPushForwarder as unknown as Mock

const SLUG_A = 'test-task-blocked-a'
const SLUG_B = 'test-task-blocked-b'
let tenantA = ''
let tenantB = ''
const U: Record<string, { id: string; tenantId: string }> = {}

const today = () => new Date().toISOString().slice(0, 10)
const KEY = 'task:submit-arrival-times:500:longhaul-activity:1'

function appAs(who: string) {
  const u = U[who]!
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', u.tenantId)
    c.set('userId', u.id)
    c.set('correlationId', 'corr-test')
    c.set(
      'db',
      createTenantDb(db as unknown as PrismaClient, u.tenantId) as unknown as PrismaClient,
    )
    await next()
  })
  app.route('/me/tasks', meTasksHandler)
  return app
}

async function put(who: string, body: unknown) {
  const res = await appAs(who).request('/me/tasks/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as { data: Record<string, unknown> } }
}

async function list(who: string) {
  const res = await appAs(who).request(`/me/tasks?today=${today()}`)
  return (await res.json()) as { data: Array<{ key: string; blocked: unknown }> }
}

async function wipe(tenantId: string) {
  await db.notification.deleteMany({ where: { tenantId } })
  await db.pushNotificationOutbox.deleteMany({ where: { tenantId } })
  await db.taskState.deleteMany({ where: { tenantId } })
  await db.tenantUser.deleteMany({ where: { tenantId } })
}

afterAll(async () => {
  if (!hasDb) return
  for (const t of [tenantA, tenantB].filter(Boolean)) await wipe(t).catch(() => undefined)
  await db.$disconnect()
})

describe.skipIf(!hasDb)('Blocked tasks (integration)', () => {
  beforeAll(async () => {
    const settings = { operations: { driverTaskRules: ['submit-arrival-times'] } }
    const upsert = (slug: string) =>
      db.tenant.upsert({
        where: { slug },
        create: { name: slug, slug, appSettings: settings },
        update: { appSettings: settings },
      })
    tenantA = (await upsert(SLUG_A)).id
    tenantB = (await upsert(SLUG_B)).id
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    cs.mockResolvedValue('Server=fake')
    kick.mockResolvedValue(true)
    fetchMock.mockResolvedValue({
      items: [
        {
          key: 'longhaul-activity:1',
          source: { kind: 'longhaul-activity', activityId: 1 },
          orderNum: 500,
          shipperName: 'SMITH',
          actCode: 'PACK',
          actName: 'Pack',
          known: true,
          kind: 'act',
          day: today(),
          actual: null,
          assertion: null,
        },
      ],
      failed: [],
      overCap: [],
    })
    await wipe(tenantA)
    await wipe(tenantB)
    const mk = async (
      key: string,
      tenantId: string,
      roleNames: string[],
      extra: Record<string, unknown> = {},
    ) => {
      const row = await db.tenantUser.create({
        data: { tenantId, email: `${key}@blocked.test`, roleNames, status: 'ACTIVE', ...extra },
      })
      U[key] = { id: row.id, tenantId }
    }
    await mk('driver', tenantA, ['driver'], { longhaulDriverId: 7 })
    await mk('ops', tenantA, ['operations_admin'])
    await mk('admin', tenantA, ['tenant_admin'])
    await mk('sales', tenantA, ['sales'])
    await mk('gone', tenantA, ['operations_admin'], { status: 'DEACTIVATED' })
    await mk('bot', tenantA, ['operations_admin'], { isServiceAccount: true })
    await mk('elsewhere', tenantB, ['operations_admin'])
  })

  const block = (reason = 'Customer not home') =>
    put('driver', { key: KEY, blocked: { reason }, today: today() })

  it("notifies the tenant's active operations users, once, and kicks delivery", async () => {
    const r = await block()
    expect(r.status).toBe(200)
    expect(r.body['data']).toMatchObject({ blocked: { reason: 'Customer not home' }, notified: 2 })

    const rows = await db.notification.findMany({ where: { type: 'task.blocked' } })
    expect(rows.map((n) => n.recipientUserId).sort()).toEqual([U['ops']!.id, U['admin']!.id].sort())
    expect(rows[0]).toMatchObject({
      tenantId: tenantA,
      actorUserId: U['driver']!.id,
      entityType: 'order',
      entityId: '500',
      title: 'driver@blocked.test is blocked on #500',
      data: { type: 'task.blocked', orderNum: '500', taskKey: KEY },
    })
    expect(await db.pushNotificationOutbox.count({ where: { tenantId: tenantA } })).toBe(2)
    expect(kick).toHaveBeenCalledTimes(1)

    // Blocking again (a new reason) updates the reason but tells no one again.
    const again = await block('Gate locked')
    expect(again.body['data']).toMatchObject({ blocked: { reason: 'Gate locked' }, notified: 0 })
    expect(await db.notification.count({ where: { type: 'task.blocked' } })).toBe(2)
  })

  it('keeps a blocked task on the list even when snoozed, and unblocks', async () => {
    await block()
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString()
    await put('driver', { key: KEY, snoozedUntil: tomorrow })
    expect((await list('driver')).data).toMatchObject([
      { key: KEY, blocked: { reason: 'Customer not home' } },
    ])

    const r = await put('driver', { key: KEY, blocked: null })
    expect(r.body['data']).toMatchObject({ blocked: null, notified: 0 })
    // Unblocked, the snooze applies again.
    expect((await list('driver')).data).toEqual([])
  })

  it("refuses a key that isn't one of the caller's tasks, and tells no one", async () => {
    const r = await put('driver', {
      key: 'task:submit-arrival-times:999:longhaul-activity:9',
      blocked: { reason: 'x' },
      today: today(),
    })
    expect(r.status).toBe(404)
    expect(await db.notification.count({ where: { tenantId: tenantA } })).toBe(0)
  })

  it('fails closed when the itinerary cannot be read', async () => {
    fetchMock.mockResolvedValue({ items: [], failed: ['longhaul', 'order'], overCap: [] })
    const r = await block()
    expect(r.status).toBe(503)
    expect(await db.taskState.count({ where: { tenantId: tenantA } })).toBe(0)
    expect(await db.notification.count({ where: { tenantId: tenantA } })).toBe(0)
  })

  it('requires the driver’s day to block', async () => {
    const r = await put('driver', { key: KEY, blocked: { reason: 'x' } })
    expect(r.status).toBe(400)
  })
})
