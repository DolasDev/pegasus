/**
 * Integration tests for the Activity feed: lib/notify.ts writing rows, the
 * /me/activity and /me/notification-preferences routes reading them, and
 * POST /notifications/send going through notify().
 *
 * Runs against Postgres through `createTenantDb` (the scoped client
 * tenantMiddleware installs), so tenant + user isolation is real. Requires a
 * live PostgreSQL database; skipped when DATABASE_URL is not set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { db } from '../db'
import { createTenantDb } from '../lib/prisma'
import { notify } from '../lib/notify'
import { registerTestErrorHandler } from '../test-helpers'
import { meActivityHandler, meNotificationPreferencesHandler } from './me-activity'
import { notificationsHandler } from './notifications'

const hasDb = Boolean(process.env['DATABASE_URL'])
const SLUG_A = 'test-activity-a'
const SLUG_B = 'test-activity-b'

let tenantA = ''
let tenantB = ''
const U: Record<string, { id: string; tenantId: string; roles: string[] }> = {}

function appAs(who: string) {
  const u = U[who]!
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', u.tenantId)
    c.set('userId', u.id)
    c.set('correlationId', 'corr-test')
    c.set('principal', { sub: `sub-${who}`, tenantId: u.tenantId, roleNames: u.roles })
    c.set(
      'db',
      createTenantDb(db as unknown as PrismaClient, u.tenantId) as unknown as PrismaClient,
    )
    await next()
  })
  app.route('/me/activity', meActivityHandler)
  app.route('/me/notification-preferences', meNotificationPreferencesHandler)
  app.route('/notifications', notificationsHandler)
  return app
}

async function call<T = unknown>(who: string, path: string, init?: RequestInit) {
  const res = await appAs(who).request(path, init)
  return { status: res.status, body: (await res.json()) as T }
}

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
})

async function wipe(tenantId: string) {
  await db.notification.deleteMany({ where: { tenantId } })
  await db.notificationPreference.deleteMany({ where: { tenantId } })
  await db.pushNotificationOutbox.deleteMany({ where: { tenantId } })
  await db.crewMember.deleteMany({ where: { tenantId } })
  await db.tenantUser.deleteMany({ where: { tenantId } })
}

/** notify() through the tenant-scoped client, as handlers call it. */
function notifyAs(tenantId: string, input: Parameters<typeof notify>[2]) {
  const scoped = createTenantDb(db as unknown as PrismaClient, tenantId) as unknown as PrismaClient
  return scoped.$transaction((tx) => notify(tx, tenantId, input))
}

afterAll(async () => {
  if (!hasDb) return
  for (const t of [tenantA, tenantB].filter(Boolean)) await wipe(t).catch(() => undefined)
  await db.$disconnect()
})

type Item = {
  id: string
  type: string
  title: string
  readAt: string | null
  actorName: string | null
}
type ListBody = { data: Item[]; meta: { nextCursor: string | null; unseen: number } }

describe.skipIf(!hasDb)('Activity feed (integration)', () => {
  beforeAll(async () => {
    process.env['AUTHZ_OFFLINE'] = 'true'
    const upsert = (slug: string) =>
      db.tenant.upsert({ where: { slug }, create: { name: slug, slug }, update: {} })
    tenantA = (await upsert(SLUG_A)).id
    tenantB = (await upsert(SLUG_B)).id
  })

  beforeEach(async () => {
    await wipe(tenantA)
    await wipe(tenantB)
    const mk = async (key: string, tenantId: string, roles: string[]) => {
      const row = await db.tenantUser.create({
        data: { tenantId, email: `${key}@activity.test`, roleNames: roles, status: 'ACTIVE' },
      })
      U[key] = { id: row.id, tenantId, roles }
    }
    await mk('driver', tenantA, ['driver'])
    await mk('other', tenantA, ['driver'])
    await mk('admin', tenantA, ['tenant_admin'])
    await mk('outsider', tenantB, ['driver'])
  })

  const trip = (n: number, over: Partial<Parameters<typeof notify>[2]> = {}) =>
    notifyAs(tenantA, {
      type: 'trip.assigned',
      recipient: { userId: U['driver']!.id },
      title: `Trip ${n}`,
      body: 'You have been assigned to a trip.',
      data: { type: 'trip.assigned', tripId: n },
      dedupeKey: `trip.assigned:${n}:7`,
      ...over,
    })

  it('notify() writes one feed row and one push, and dedupes a repeat', async () => {
    const first = await trip(1)
    const again = await trip(1)
    expect(first.notificationId).toBeTruthy()
    expect(first.pushId).toBeTruthy()
    expect(again).toEqual(first)
    expect(await db.notification.count({ where: { tenantId: tenantA } })).toBe(1)
    expect(await db.pushNotificationOutbox.count({ where: { tenantId: tenantA } })).toBe(1)
  })

  it('lists the caller’s own rows newest first, pages by cursor, and counts unseen', async () => {
    for (const n of [1, 2, 3]) await trip(n)
    await notifyAs(tenantA, {
      type: 'trip.assigned',
      recipient: { userId: U['other']!.id },
      title: 'Not yours',
      body: 'x',
    })

    const p1 = await call<ListBody>('driver', '/me/activity?limit=2')
    expect(p1.status).toBe(200)
    expect(p1.body.data.map((i) => i.title)).toEqual(['Trip 3', 'Trip 2'])
    expect(p1.body.meta.unseen).toBe(3)
    const p2 = await call<ListBody>(
      'driver',
      `/me/activity?limit=2&cursor=${p1.body.meta.nextCursor}`,
    )
    expect(p2.body.data.map((i) => i.title)).toEqual(['Trip 1'])
    expect(p2.body.meta.nextCursor).toBeNull()
  })

  it('clears the bell on seen, and reads one or all', async () => {
    const { notificationId } = await trip(1)
    await trip(2)
    expect(
      (await call<{ data: { unseen: number } }>('driver', '/me/activity/unseen-count')).body.data
        .unseen,
    ).toBe(2)

    await call('driver', '/me/activity/seen', post())
    expect(
      (await call<{ data: { unseen: number } }>('driver', '/me/activity/unseen-count')).body.data
        .unseen,
    ).toBe(0)

    expect((await call('driver', `/me/activity/${notificationId}/read`, post())).status).toBe(200)
    const unread = await call<ListBody>('driver', '/me/activity?filter=unread')
    expect(unread.body.data.map((i) => i.title)).toEqual(['Trip 2'])

    await call('driver', '/me/activity/read-all', post())
    expect((await call<ListBody>('driver', '/me/activity?filter=unread')).body.data).toEqual([])
  })

  it("can't read or mark another user's, or another tenant's, rows", async () => {
    const { notificationId } = await trip(1)
    expect((await call('other', `/me/activity/${notificationId}/read`, post())).status).toBe(404)
    expect((await call('outsider', `/me/activity/${notificationId}/read`, post())).status).toBe(404)
    expect((await call<ListBody>('other', '/me/activity')).body.data).toEqual([])
    expect((await call<ListBody>('outsider', '/me/activity')).body.data).toEqual([])
    await call('other', '/me/activity/read-all', post())
    const row = await db.notification.findUniqueOrThrow({ where: { id: notificationId! } })
    expect(row.readAt).toBeNull()
  })

  it('honours the channel preference: feed (no push), then off (nothing)', async () => {
    const defaults = await call<{ data: Array<{ type: string; channel: string }> }>(
      'driver',
      '/me/notification-preferences',
    )
    expect(defaults.body.data.find((p) => p.type === 'trip.assigned')?.channel).toBe('push')

    const put = (channel: string) =>
      call('driver', '/me/notification-preferences', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'trip.assigned', channel }),
      })
    expect((await put('feed')).status).toBe(200)
    expect(await trip(1)).toMatchObject({ pushId: null })
    expect(await db.pushNotificationOutbox.count({ where: { tenantId: tenantA } })).toBe(0)

    await put('off')
    expect(await trip(2)).toEqual({ notificationId: null, pushId: null })
    expect((await put('loud')).status).toBe(400)
  })

  it('pushes to a crew member with no login and writes no feed row', async () => {
    const crew = await db.crewMember.create({
      data: { tenantId: tenantA, name: 'Pat Crew', role: 'DRIVER', licenceClasses: [] },
    })
    const r = await notifyAs(tenantA, {
      type: 'move.assigned',
      recipient: { crewMemberId: crew.id },
      title: 'New assignment',
      body: 'x',
    })
    expect(r.notificationId).toBeNull()
    expect(r.pushId).toBeTruthy()
  })

  it("POST /notifications/send refuses another tenant's user", async () => {
    const res = await call<{ code: string }>(
      'admin',
      '/notifications/send',
      post({ userId: U['outsider']!.id, title: 'Hi', body: 'x' }),
    )
    expect(res.status).toBe(404)
    expect(await db.notification.count({ where: { recipientUserId: U['outsider']!.id } })).toBe(0)
  })

  it('POST /notifications/send writes an Activity row with the sender as actor', async () => {
    const res = await call<{ data: { id: string; notificationId: string; pushId: string } }>(
      'admin',
      '/notifications/send',
      post({ userId: U['driver']!.id, title: 'Call the office', body: 'Please call dispatch.' }),
    )
    expect(res.status).toBe(202)
    expect(res.body.data.id).toBe(res.body.data.pushId)
    const list = await call<ListBody>('driver', '/me/activity')
    expect(list.body.data).toMatchObject([
      { type: 'staff.message', title: 'Call the office', actorName: 'admin@activity.test' },
    ])
  })
})
