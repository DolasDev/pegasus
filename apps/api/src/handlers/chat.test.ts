/**
 * Integration tests for /api/v1/chat (move chat).
 *
 * Runs the real router against Postgres through `createTenantDb` — the scoped
 * client tenantMiddleware installs — with Cedar evaluated offline. The legacy
 * (pegII) database is a small in-memory fake behind the mocked mssql-executor
 * client, and Expo is mocked, so access rules, the push fan-out and the inline
 * delivery are all exercised end to end.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'

vi.mock('../lib/mssql-executor-client', () => ({ executeSql: vi.fn() }))
vi.mock('../lib/push-forward-invoke', () => ({ kickPushForwarder: vi.fn() }))

import type { AppEnv } from '../types'
import { db } from '../db'
import { createTenantDb } from '../lib/prisma'
import { registerTestErrorHandler } from '../test-helpers'
import { executeSql } from '../lib/mssql-executor-client'
import { kickPushForwarder } from '../lib/push-forward-invoke'
import { chatHandler, ACCESS_CACHE_MS } from './chat'
import { localDriversHandler } from './local-drivers'

const hasDb = Boolean(process.env['DATABASE_URL'])
const exec = executeSql as unknown as Mock
const kick = kickPushForwarder as unknown as Mock

const SLUG_A = 'test-move-chat-a'
const SLUG_B = 'test-move-chat-b'

// ---------------------------------------------------------------------------
// Fake legacy database: which orders exist and who drives them.
// ---------------------------------------------------------------------------
const legacy = {
  orders: new Set<number>(),
  longhaul: new Map<number, number[]>(),
  local: new Map<number, number[]>(),
  crews: [] as Array<{ employee_id: number; first: string; last: string }>,
  salesDown: false,
}

function canRead(order: number, lh: unknown, ld: unknown): boolean {
  return (
    (typeof lh === 'number' && (legacy.longhaul.get(order) ?? []).includes(lh)) ||
    (typeof ld === 'number' && (legacy.local.get(order) ?? []).includes(ld))
  )
}

function fakeExecute(
  _cs: string,
  sql: string,
  opts?: { params?: Array<{ name: string; value: unknown }> },
) {
  const p = Object.fromEntries((opts?.params ?? []).map((x) => [x.name, x.value]))
  const rs = (recordset: unknown[]) => Promise.resolve({ recordset, rowsAffected: [] })
  if (sql.startsWith('SELECT CASE WHEN')) {
    return rs([{ ok: canRead(p['orderNum'] as number, p['lh'], p['ld']) ? 1 : 0 }])
  }
  if (sql.includes('FROM (VALUES')) {
    const orders = Object.entries(p)
      .filter(([k]) => /^o\d+$/.test(k))
      .map(([, v]) => v as number)
    return rs(orders.filter((o) => canRead(o, p['lh'], p['ld'])).map((o) => ({ order_num: o })))
  }
  if (sql.includes('SELECT a.assigned_driver_id')) {
    return rs(
      (legacy.longhaul.get(p['orderNum'] as number) ?? []).map((id) => ({
        assigned_driver_id: id,
        trip_driver_id: null,
      })),
    )
  }
  if (sql.includes('SELECT j.driver_id1')) {
    return rs(
      (legacy.local.get(p['orderNum'] as number) ?? []).map((id) => ({
        driver_id1: id,
        driver_id2: 0,
      })),
    )
  }
  if (sql.includes('SELECT s.order_num')) {
    if (legacy.salesDown) return Promise.reject(new Error('tunnel down'))
    const driverScoped =
      sql.includes('LongDistanceDispatchActivity') || sql.includes('LocalDispatchJobs')
    const orders = Object.entries(p)
      .filter(([k]) => /^o\d+$/.test(k))
      .map(([, v]) => v as number)
      .filter((o) => legacy.orders.has(o))
      .filter((o) => !driverScoped || canRead(o, p['lh'], p['ld']))
    return rs(
      orders.map((o) => ({
        order_num: o,
        shipper_name: `  SHIPPER ${o} `,
        shipper_city: 'Austin',
        shipper_state: 'TX',
        consignee_city: '',
        consignee_state: 'CO',
        pack_date: '2026-10-21T00:00:00.000Z',
        load_date: null,
        del_date: '2026-10-25T00:00:00.000Z',
      })),
    )
  }
  if (sql.includes('FROM sales')) {
    return rs(legacy.orders.has(p['orderNum'] as number) ? [{ one: 1 }] : [])
  }
  if (sql.includes('FROM crews')) return rs(legacy.crews)
  return Promise.reject(new Error(`unexpected SQL: ${sql}`))
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
let tenantA: string
let tenantB: string
const U: Record<string, { id: string; roles: string[]; tenantId: string }> = {}

function appAs(who: keyof typeof U | string, opts: { apiClient?: boolean } = {}) {
  const u = U[who]!
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', u.tenantId)
    c.set('userId', u.id)
    c.set('correlationId', 'corr-test')
    c.set('principal', { sub: `sub-${who}`, tenantId: u.tenantId, roleNames: u.roles })
    if (opts.apiClient) c.set('apiClient', { id: 'ac-1' } as never)
    c.set(
      'db',
      createTenantDb(db as unknown as PrismaClient, u.tenantId) as unknown as PrismaClient,
    )
    await next()
  })
  app.route('/chat', chatHandler)
  app.route('/local-drivers', localDriversHandler)
  return app
}

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

type Msg = {
  id: string
  body: string | null
  clientMessageId: string
  mentionedUserIds: string[]
  deletedAt: string | null
  author: { id: string; name: string }
}

let seq = 0
const cid = () => `client-msg-${++seq}-${Date.now()}`

async function post(who: string, order: number | string, body: string, clientMessageId = cid()) {
  return appAs(who).request(
    `/chat/rooms/shipment/${order}/messages`,
    json({ clientMessageId, body }),
  )
}

async function codeOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { code?: string }).code
}

async function data<T>(res: Response): Promise<T> {
  return ((await res.json()) as { data: T }).data
}

async function wipeTenant(tenantId: string) {
  await db.chatMessage.deleteMany({ where: { tenantId } })
  await db.chatRoomMember.deleteMany({ where: { tenantId } })
  await db.chatRoom.deleteMany({ where: { tenantId } })
  await db.pushNotificationOutbox.deleteMany({ where: { tenantId } })
  await db.deviceToken.deleteMany({ where: { tenantId } })
  await db.tenantUser.deleteMany({ where: { tenantId } })
}

afterAll(async () => {
  if (!hasDb) return
  for (const t of [tenantA, tenantB].filter(Boolean)) await wipeTenant(t).catch(() => undefined)
  await db.$disconnect()
})

describe.skipIf(!hasDb)('/chat (integration)', () => {
  beforeAll(async () => {
    process.env['AUTHZ_OFFLINE'] = 'true'
    const upsert = (slug: string) =>
      db.tenant.upsert({
        where: { slug },
        create: { name: slug, slug, mssqlConnectionString: 'Server=fake' },
        update: { mssqlConnectionString: 'Server=fake' },
      })
    tenantA = (await upsert(SLUG_A)).id
    tenantB = (await upsert(SLUG_B)).id
  })

  beforeEach(async () => {
    exec.mockReset()
    exec.mockImplementation(fakeExecute)
    kick.mockReset()
    kick.mockResolvedValue(true)
    legacy.orders = new Set([100, 200, 300])
    legacy.longhaul = new Map([[100, [7]]])
    legacy.local = new Map([[200, [9]]])
    legacy.crews = []
    legacy.salesDown = false

    await wipeTenant(tenantA)
    await wipeTenant(tenantB)
    const mk = async (
      key: string,
      tenantId: string,
      roles: string[],
      extra: { longhaulDriverId?: number; localDriverEmployeeId?: number } = {},
    ) => {
      const row = await db.tenantUser.create({
        data: { tenantId, email: `${key}@chat.test`, roleNames: roles, status: 'ACTIVE', ...extra },
      })
      U[key] = { id: row.id, roles, tenantId }
      await db.deviceToken.create({
        data: {
          tenantId,
          userId: row.id,
          platform: 'IOS',
          expoPushToken: `ExponentPushToken[${key}]`,
        },
      })
    }
    await mk('sales', tenantA, ['sales'])
    await mk('ops', tenantA, ['operations_admin'])
    await mk('admin', tenantA, ['tenant_admin'])
    await mk('driver', tenantA, ['driver'], { longhaulDriverId: 7 })
    await mk('localDriver', tenantA, ['driver'], { localDriverEmployeeId: 9 })
    await mk('otherDriver', tenantA, ['driver'], { longhaulDriverId: 8 })
    await mk('unmapped', tenantA, ['driver'])
    await mk('outsider', tenantB, ['tenant_admin'])
  })

  /** Expo tokens each push was sent to. */
  type Push = { title: string; body: string; data: Record<string, unknown> }
  /** The push outbox rows written so far, keyed by recipient fixture name. */
  async function pushes(): Promise<Map<string, Push>> {
    const rows = await db.pushNotificationOutbox.findMany({ where: { tenantId: tenantA } })
    const byId = new Map(Object.entries(U).map(([k, u]) => [u.id, k]))
    return new Map(rows.map((r) => [byId.get(r.userId!)!, r.payload as Push]))
  }
  const pushedTo = async () => [...(await pushes()).keys()].sort()
  const clearPushes = () => db.pushNotificationOutbox.deleteMany({ where: { tenantId: tenantA } })

  // ── rooms and posting ─────────────────────────────────────────────────────

  it('an employee posts the first message on an existing order; the room appears', async () => {
    const res = await post('sales', 100, '  Truck is loaded  ')
    expect(res.status).toBe(201)
    const msg = await data<Msg>(res)
    expect(msg.body).toBe('Truck is loaded')
    expect(msg.author).toEqual({ id: U['sales']!.id, name: 'sales@chat.test' })

    const room = await data<{ room: { id: string; lastMessageAt: string } }>(
      await appAs('ops').request('/chat/rooms/shipment/100'),
    )
    expect(room.room.id).toBeTruthy()
    const list = await data<Msg[]>(await appAs('ops').request('/chat/rooms/shipment/100/messages'))
    expect(list.map((m) => m.id)).toEqual([msg.id])
  })

  it('answers an empty room for an order nobody has chatted on yet', async () => {
    const res = await appAs('sales').request('/chat/rooms/shipment/300')
    expect(res.status).toBe(200)
    expect(await data(res)).toEqual({
      room: { id: null, entityType: 'shipment', entityId: '300', lastMessageAt: null },
      membership: null,
      unreadCount: 0,
    })
  })

  it('refuses to create a room for an order that does not exist', async () => {
    const res = await post('sales', 999, 'hello')
    expect(res.status).toBe(404)
    expect(await codeOf(res)).toBe('ORDER_NOT_FOUND')
  })

  it.each([
    ['/chat/rooms/move/abc', 'CHAT_UNSUPPORTED_ENTITY'],
    ['/chat/rooms/shipment/007', 'CHAT_INVALID_ENTITY_ID'],
  ])('rejects the room reference %s', async (path, code) => {
    const res = await appAs('sales').request(path)
    expect(res.status).toBe(400)
    expect(await codeOf(res)).toBe(code)
  })

  it('validates the body and the clientMessageId', async () => {
    expect(await codeOf(await post('sales', 100, '   '))).toBe('CHAT_BODY_EMPTY')
    const bad = await appAs('sales').request(
      '/chat/rooms/shipment/100/messages',
      json({ clientMessageId: 'x', body: 'hi' }),
    )
    expect(bad.status).toBe(400)
    expect(await codeOf(bad)).toBe('VALIDATION_ERROR')
  })

  it('stores a resent message once (idempotent on clientMessageId)', async () => {
    const id = cid()
    const first = await post('sales', 100, 'once', id)
    const again = await post('sales', 100, 'once', id)
    expect(first.status).toBe(201)
    expect(again.status).toBe(200)
    expect((await data<Msg>(again)).id).toBe((await data<Msg>(first)).id)
    expect(await db.chatMessage.count({ where: { tenantId: tenantA } })).toBe(1)

    const elsewhere = await post('sales', 300, 'once', id)
    expect(elsewhere.status).toBe(409)
  })

  it('refuses callers that are API clients', async () => {
    const res = await appAs('sales', { apiClient: true }).request('/chat/rooms/shipment/100')
    expect(res.status).toBe(403)
    expect(await codeOf(res)).toBe('CHAT_HUMANS_ONLY')
  })

  it('keeps tenants apart: another tenant sees an empty room for the same order', async () => {
    await post('sales', 100, 'tenant A only')
    const res = await appAs('outsider').request('/chat/rooms/shipment/100/messages')
    expect(await data(res)).toEqual([])
  })

  // ── driver access (D1/D2) ─────────────────────────────────────────────────

  it('a longhaul driver reads and posts on their own move, not on others', async () => {
    await post('sales', 100, 'for the driver')
    const mine = await appAs('driver').request('/chat/rooms/shipment/100/messages')
    expect(mine.status).toBe(200)
    expect(await data<Msg[]>(mine)).toHaveLength(1)
    expect((await post('driver', 100, 'on my way')).status).toBe(201)

    const theirs = await appAs('otherDriver').request('/chat/rooms/shipment/100/messages')
    expect(theirs.status).toBe(403)
    expect(await codeOf(theirs)).toBe('CHAT_FORBIDDEN')
    expect((await post('otherDriver', 100, 'sneaky')).status).toBe(403)
  })

  it('a local driver reaches moves through their local dispatch driver slot', async () => {
    expect((await appAs('localDriver').request('/chat/rooms/shipment/200')).status).toBe(200)
    expect((await appAs('localDriver').request('/chat/rooms/shipment/100')).status).toBe(403)
  })

  it('a driver login with no mapping reaches nothing', async () => {
    expect((await appAs('unmapped').request('/chat/rooms/shipment/100')).status).toBe(403)
  })

  it('never sends a driver poll of a room-less order to the legacy database', async () => {
    exec.mockClear()
    for (let i = 0; i < 2; i++) {
      const res = await appAs('driver').request('/chat/rooms/shipment/100/messages')
      expect(res.status).toBe(200)
      expect(await data(res)).toEqual([])
    }
    expect(exec).not.toHaveBeenCalled()
  })

  it('serves a driver poll from the cached access check, and re-checks once it is stale', async () => {
    await post('sales', 100, 'hello')
    await appAs('driver').request('/chat/rooms/shipment/100') // full check, stamps the row
    exec.mockClear()

    await appAs('driver').request('/chat/rooms/shipment/100/messages')
    expect(exec).not.toHaveBeenCalled()

    await db.chatRoomMember.updateMany({
      where: { userId: U['driver']!.id },
      data: { accessCheckedAt: new Date(Date.now() - ACCESS_CACHE_MS - 1000) },
    })
    legacy.longhaul.set(100, []) // taken off the trip
    const res = await appAs('driver').request('/chat/rooms/shipment/100/messages')
    expect(res.status).toBe(403)
  })

  it('employees never touch the legacy database to read', async () => {
    await post('sales', 100, 'hello')
    exec.mockClear()
    await appAs('ops').request('/chat/rooms/shipment/100/messages')
    expect(exec).not.toHaveBeenCalled()
  })

  // ── notifications (D4/D5) ─────────────────────────────────────────────────

  it('queues a push for the assigned driver (not the author, without the text) and kicks the forwarder', async () => {
    const res = await post('sales', 100, 'Customer gate code is 4411')
    expect(res.status).toBe(201)

    expect(await pushedTo()).toEqual(['driver'])
    const payload = (await pushes()).get('driver')!
    expect(payload.title).toBe('#100')
    expect(payload.body).toBe('New message from sales@chat.test')
    expect(JSON.stringify(payload)).not.toContain('4411')
    expect(payload.data).toMatchObject({ type: 'chat.message', orderNum: '100' })
    expect(kick).toHaveBeenCalledTimes(1)
  })

  it('does not kick the forwarder when nobody is to be notified', async () => {
    const res = await post('sales', 300, 'nobody drives 300 and nobody follows it')
    expect(res.status).toBe(201)
    expect(await pushedTo()).toEqual([])
    expect(kick).not.toHaveBeenCalled()
  })

  it('a mention makes the employee follow, pages them, and gets through a mute', async () => {
    const opsId = U['ops']!.id
    await post('sales', 100, `@[Ops](${opsId}) can you check?`)
    expect(await pushedTo()).toEqual(['driver', 'ops'])
    expect((await pushes()).get('ops')!.body).toBe('sales@chat.test mentioned you')

    // ops now follows; muting silences plain messages but not mentions
    await appAs('ops').request('/chat/rooms/shipment/100/membership', json({ muted: true }, 'PUT'))
    await clearPushes()
    await post('sales', 100, 'plain update')
    expect(await pushedTo()).toEqual(['driver'])
    await clearPushes()
    await post('sales', 100, `@[Ops](${opsId}) again`)
    expect(await pushedTo()).toContain('ops')
  })

  it('ignores a mention of someone who cannot see the move', async () => {
    const res = await post('sales', 100, `@[X](${U['otherDriver']!.id}) hi`)
    expect((await data<Msg>(res)).mentionedUserIds).toEqual([])
    expect(await pushedTo()).not.toContain('otherDriver')
  })

  it('stops pushing a driver who was taken off the move, even though they follow it', async () => {
    await post('sales', 100, 'first')
    await appAs('driver').request('/chat/rooms/shipment/100') // driver now follows
    legacy.longhaul.set(100, [])
    await clearPushes()
    await post('sales', 100, 'second')
    expect(await pushedTo()).not.toContain('driver')
  })

  it('posts even when the legacy database is down for the fan-out', async () => {
    await post('sales', 100, 'room exists now')
    exec.mockRejectedValue(new Error('tunnel down'))
    const res = await post('ops', 100, 'still works')
    expect(res.status).toBe(201)
  })

  // ── reading, paging, unread ───────────────────────────────────────────────

  it('pages forward with after and back with before', async () => {
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push((await data<Msg>(await post('sales', 100, `m${i}`))).id)
    const app = appAs('ops')
    const newest2 = await data<Msg[]>(
      await app.request('/chat/rooms/shipment/100/messages?limit=2'),
    )
    expect(newest2.map((m) => m.body)).toEqual(['m3', 'm4'])
    const older = await data<Msg[]>(
      await app.request(`/chat/rooms/shipment/100/messages?before=${ids[3]}&limit=2`),
    )
    expect(older.map((m) => m.body)).toEqual(['m1', 'm2'])
    const newer = await data<Msg[]>(
      await app.request(`/chat/rooms/shipment/100/messages?after=${ids[2]}`),
    )
    expect(newer.map((m) => m.body)).toEqual(['m3', 'm4'])

    const bad = await app.request('/chat/rooms/shipment/100/messages?after=nope')
    expect(bad.status).toBe(400)
  })

  it('counts unread for others, clears on read, and never moves the cursor back', async () => {
    await post('sales', 100, 'one')
    await post('sales', 100, 'two')
    const ops = appAs('ops')
    const before = await data<{ unreadCount: number }>(
      await ops.request('/chat/rooms/shipment/100'),
    )
    expect(before.unreadCount).toBe(2)
    expect(
      (
        await data<{ unreadCount: number }>(
          await appAs('sales').request('/chat/rooms/shipment/100'),
        )
      ).unreadCount,
    ).toBe(0) // the author has read their own messages

    const read = await data<{ lastReadAt: string }>(
      await ops.request('/chat/rooms/shipment/100/read', json({})),
    )
    expect(
      (await data<{ unreadCount: number }>(await ops.request('/chat/rooms/shipment/100')))
        .unreadCount,
    ).toBe(0)
    const back = await data<{ lastReadAt: string }>(
      await ops.request('/chat/rooms/shipment/100/read', json({ at: '2020-01-01T00:00:00Z' })),
    )
    expect(back.lastReadAt).toBe(read.lastReadAt)
  })

  it('lists my followed conversations with previews and unread counts', async () => {
    const opsId = U['ops']!.id
    await post('sales', 100, `@[Ops](${opsId}) look at 100`)
    await post('sales', 200, 'nobody mentioned here')
    const inbox = await data<
      Array<{
        room: { entityId: string }
        unreadCount: number
        unreadMentionCount: number
        lastMessage: { preview: string }
      }>
    >(await appAs('ops').request('/chat/inbox'))
    expect(inbox.map((r) => r.room.entityId)).toEqual(['100'])
    expect(inbox[0]).toMatchObject({ unreadCount: 1, unreadMentionCount: 1 })
    expect(inbox[0]!.lastMessage.preview).toContain('look at 100')

    const all = await data<Array<{ room: { entityId: string } }>>(
      await appAs('ops').request('/chat/inbox?filter=all'),
    )
    expect(all.map((r) => r.room.entityId).sort()).toEqual(['100', '200'])
  })

  it("drops a room from a driver's inbox once they are taken off the move", async () => {
    await post('sales', 100, 'hello driver')
    await appAs('driver').request('/chat/rooms/shipment/100') // follows
    expect(await data<unknown[]>(await appAs('driver').request('/chat/inbox'))).toHaveLength(1)

    // a driver's `all` is just their followed rooms
    expect(
      await data<unknown[]>(await appAs('driver').request('/chat/inbox?filter=all')),
    ).toHaveLength(1)

    await db.chatRoomMember.updateMany({
      where: { userId: U['driver']!.id },
      data: { accessCheckedAt: new Date(Date.now() - ACCESS_CACHE_MS - 1000) },
    })
    legacy.longhaul.set(100, [])
    expect(await data<unknown[]>(await appAs('driver').request('/chat/inbox'))).toHaveLength(0)
  })

  // ── delete, membership, mentionable ───────────────────────────────────────

  it('soft-deletes your own message; others need tenant_admin', async () => {
    const msg = await data<Msg>(await post('sales', 100, 'oops'))
    expect(
      (await appAs('ops').request(`/chat/messages/${msg.id}`, { method: 'DELETE' })).status,
    ).toBe(403)
    const del = await appAs('sales').request(`/chat/messages/${msg.id}`, { method: 'DELETE' })
    expect(del.status).toBe(200)
    expect(await data(del)).toMatchObject({ body: null, deletedAt: expect.any(String) })
    const row = await db.chatMessage.findUnique({ where: { id: msg.id } })
    expect(row?.body).toBe('')

    const other = await data<Msg>(await post('ops', 100, 'admin removes this'))
    expect(
      (await appAs('admin').request(`/chat/messages/${other.id}`, { method: 'DELETE' })).status,
    ).toBe(200)
    expect((await appAs('sales').request('/chat/messages/nope', { method: 'DELETE' })).status).toBe(
      404,
    )
  })

  it('follows and unfollows a room, creating it for an existing order', async () => {
    const app = appAs('ops')
    const on = await app.request(
      '/chat/rooms/shipment/300/membership',
      json({ following: true }, 'PUT'),
    )
    expect(await data(on)).toEqual({ following: true, muted: false })
    const off = await app.request(
      '/chat/rooms/shipment/300/membership',
      json({ following: false }, 'PUT'),
    )
    expect(await data(off)).toEqual({ following: false, muted: false })
    expect(
      (await app.request('/chat/rooms/shipment/999/membership', json({ following: true }, 'PUT')))
        .status,
    ).toBe(404)
    expect((await app.request('/chat/rooms/shipment/300/membership', json({}, 'PUT'))).status).toBe(
      400,
    )
  })

  it('offers employees and the move’s drivers as mention candidates', async () => {
    const list = await data<Array<{ name: string; kind: string }>>(
      await appAs('sales').request('/chat/rooms/shipment/100/mentionable'),
    )
    expect(list).toContainEqual({
      userId: U['driver']!.id,
      name: 'driver@chat.test',
      kind: 'driver',
    })
    expect(list.map((x) => x.name)).toContain('ops@chat.test')
    expect(list.map((x) => x.name)).not.toContain('otherDriver@chat.test')
    expect(list.map((x) => x.name)).not.toContain('outsider@chat.test')
  })

  // ── summaries ─────────────────────────────────────────────────────────────

  it('summarizes orders for the page header in one legacy read', async () => {
    const res = await appAs('sales').request('/chat/summaries?entityType=shipment&ids=100,200,999')
    expect(res.status).toBe(200)
    const list = await data<Array<{ orderNum: number }>>(res)
    expect(list).toEqual([
      {
        orderNum: 100,
        shipperName: 'SHIPPER 100',
        origin: 'Austin, TX',
        destination: 'CO',
        packDate: '2026-10-21',
        loadDate: null,
        deliveryDate: '2026-10-25',
      },
      expect.objectContaining({ orderNum: 200 }),
    ])
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('gives a driver summaries only for their own moves', async () => {
    const list = await data<Array<{ orderNum: number }>>(
      await appAs('driver').request('/chat/summaries?entityType=shipment&ids=100,200,300'),
    )
    expect(list.map((x) => x.orderNum)).toEqual([100])
    const none = await data<unknown[]>(
      await appAs('unmapped').request('/chat/summaries?entityType=shipment&ids=100'),
    )
    expect(none).toEqual([])
  })

  it('validates summary ids and reports a legacy outage as 503', async () => {
    expect(
      (await appAs('sales').request('/chat/summaries?entityType=shipment&ids=1,abc')).status,
    ).toBe(400)
    expect((await appAs('sales').request('/chat/summaries?entityType=move&ids=1')).status).toBe(400)
    const many = Array.from({ length: 101 }, (_, i) => i + 1).join(',')
    expect(
      (await appAs('sales').request(`/chat/summaries?entityType=shipment&ids=${many}`)).status,
    ).toBe(400)
    legacy.salesDown = true
    const down = await appAs('sales').request('/chat/summaries?entityType=shipment&ids=100')
    expect(down.status).toBe(503)
    expect(await codeOf(down)).toBe('LEGACY_UNAVAILABLE')
  })

  // ── local-drivers picker ──────────────────────────────────────────────────

  it('lists local drivers for the admin picker, and refuses non-admins', async () => {
    legacy.crews = [{ employee_id: 9, first: 'ANN', last: 'LEE' }]
    const res = await appAs('admin').request('/local-drivers')
    expect(res.status).toBe(200)
    expect(await data(res)).toEqual([{ employeeId: 9, name: 'LEE, ANN' }])
    expect((await appAs('driver').request('/local-drivers')).status).toBe(403)
  })
})
