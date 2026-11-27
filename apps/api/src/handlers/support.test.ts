/**
 * Integration tests for /api/v1/support (a tenant user's own threads with the
 * platform operator).
 *
 * Runs the real router against Postgres through `createTenantDb` — the scoped
 * client tenantMiddleware installs — with Cedar evaluated offline. The SNS
 * alert is mocked; its debounce decision is what's asserted.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type * as SupportAlert from '../lib/support-alert'

import type * as SupportTriageInvoke from '../lib/support-triage-invoke'

vi.mock('../lib/support-alert', async (importOriginal) => ({
  ...(await importOriginal<typeof SupportAlert>()),
  alertOperator: vi.fn(),
}))
vi.mock('../lib/support-triage-invoke', async (orig) => ({
  ...(await orig<typeof SupportTriageInvoke>()),
  invokeSupportTriage: vi.fn(),
}))

import type { AppEnv } from '../types'
import { db } from '../db'
import { createTenantDb } from '../lib/prisma'
import { registerTestErrorHandler } from '../test-helpers'
import { alertOperator } from '../lib/support-alert'
import { invokeSupportTriage } from '../lib/support-triage-invoke'
import { supportHandler } from './support'

const hasDb = Boolean(process.env['DATABASE_URL'])
const alert = alertOperator as unknown as Mock

const SLUG_A = 'test-support-a'
const SLUG_B = 'test-support-b'

let tenantA: string
let tenantB: string
const U: Record<string, { id: string; tenantId: string; roles: string[] }> = {}

function appAs(who: string, opts: { apiClient?: boolean } = {}) {
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
  app.route('/support', supportHandler)
  return app
}

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

let seq = 0
const cid = () => `support-msg-${++seq}-${Date.now()}`

type Thread = {
  id: string
  subject: string
  status: string
  lastMessageAt: string
  unread: boolean
  pageUrl: string | null
}
type Message = {
  id: string
  authorKind: string
  authorName: string
  body: string
  clientMessageId: string
}

async function data<T>(res: Response): Promise<T> {
  return ((await res.json()) as { data: T }).data
}
async function codeOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { code?: string }).code
}

async function open(who: string, body = 'The invoice totals look wrong', extra = {}) {
  return appAs(who).request('/support/threads', json({ clientMessageId: cid(), body, ...extra }))
}

/** The operator's reply, written straight to the tables (the admin API has its own tests). */
async function operatorReply(threadId: string, tenantId: string, body = 'Looking now') {
  const m = await db.supportMessage.create({
    data: {
      tenantId,
      threadId,
      authorKind: 'operator',
      operatorSub: 'op-sub',
      operatorEmail: 'op@example.com',
      clientMessageId: cid(),
      body,
    },
  })
  await db.supportThread.update({
    where: { id: threadId },
    data: { status: 'awaiting_customer', lastAuthorKind: 'operator', lastMessageAt: m.createdAt },
  })
  return m
}

async function wipeTenant(tenantId: string) {
  await db.supportMessage.deleteMany({ where: { tenantId } })
  await db.supportThread.deleteMany({ where: { tenantId } })
  await db.tenantUser.deleteMany({ where: { tenantId } })
}

afterAll(async () => {
  if (!hasDb) return
  for (const t of [tenantA, tenantB].filter(Boolean)) await wipeTenant(t).catch(() => undefined)
  delete process.env['SUPPORT_ENABLED']
  await db.$disconnect()
})

describe.skipIf(!hasDb)('/support (integration)', () => {
  beforeAll(async () => {
    process.env['AUTHZ_OFFLINE'] = 'true'
    const upsert = (slug: string, name: string) =>
      db.tenant.upsert({ where: { slug }, create: { name, slug }, update: { name } })
    tenantA = (await upsert(SLUG_A, 'Acme Movers')).id
    tenantB = (await upsert(SLUG_B, 'Bravo Van Lines')).id
  })

  beforeEach(async () => {
    process.env['SUPPORT_ENABLED'] = 'true'
    alert.mockReset()
    alert.mockResolvedValue(true)
    await wipeTenant(tenantA)
    await wipeTenant(tenantB)
    const mk = async (key: string, tenantId: string, roles: string[]) => {
      const row = await db.tenantUser.create({
        data: { tenantId, email: `${key}@support.test`, roleNames: roles, status: 'ACTIVE' },
      })
      U[key] = { id: row.id, tenantId, roles }
    }
    await mk('alice', tenantA, ['sales'])
    await mk('bob', tenantA, ['tenant_admin'])
    await mk('driver', tenantA, ['driver'])
    await mk('carol', tenantB, ['sales'])
  })

  // -------------------------------------------------------------------------
  // Gates
  // -------------------------------------------------------------------------

  it('every route answers 404 when SUPPORT_ENABLED is off', async () => {
    delete process.env['SUPPORT_ENABLED']
    const res = await appAs('alice').request('/support/threads')
    expect(res.status).toBe(404)
    expect(await codeOf(res)).toBe('NOT_FOUND')
    expect((await open('alice')).status).toBe(404)
  })

  it('refuses API clients and service accounts', async () => {
    const res = await appAs('alice', { apiClient: true }).request('/support/threads')
    expect(res.status).toBe(403)
    expect(await codeOf(res)).toBe('SUPPORT_HUMANS_ONLY')
  })

  // -------------------------------------------------------------------------
  // Opening a thread
  // -------------------------------------------------------------------------

  it('opens a thread with its first message, waiting on the operator, and alerts', async () => {
    const res = await open('alice', 'Cannot save a trip\nIt spins forever', {
      context: { pageUrl: 'https://app.example.com/planning', appVersion: '1.2.3' },
    })
    expect(res.status).toBe(201)
    const out = await data<{ thread: Thread; message: Message }>(res)
    expect(out.thread.subject).toBe('Cannot save a trip')
    expect(out.thread.status).toBe('awaiting_operator')
    expect(out.thread.pageUrl).toBe('https://app.example.com/planning')
    expect(out.message.authorKind).toBe('customer')
    expect(out.message.body).toBe('Cannot save a trip\nIt spins forever')

    expect(alert).toHaveBeenCalledTimes(1)
    expect(alert).toHaveBeenCalledWith({
      id: out.thread.id,
      subject: 'Cannot save a trip',
      tenantName: 'Acme Movers',
      isNewThread: true,
    })
    const row = await db.supportThread.findUniqueOrThrow({ where: { id: out.thread.id } })
    expect(row.lastOperatorAlertAt).not.toBeNull()
    expect(row.tenantId).toBe(tenantA)
  })

  it('uses an explicit subject when given and drops an unsafe page URL', async () => {
    const res = await open('alice', 'details…', {
      subject: '  Billing   question ',
      context: { pageUrl: 'javascript:alert(1)' },
    })
    const out = await data<{ thread: Thread }>(res)
    expect(out.thread.subject).toBe('Billing question')
    expect(out.thread.pageUrl).toBeNull()
  })

  it('is idempotent on the first message clientMessageId', async () => {
    const clientMessageId = cid()
    const first = await appAs('alice').request(
      '/support/threads',
      json({ clientMessageId, body: 'hello' }),
    )
    const again = await appAs('alice').request(
      '/support/threads',
      json({ clientMessageId, body: 'hello' }),
    )
    expect(first.status).toBe(201)
    expect(again.status).toBe(200)
    const a = await data<{ thread: Thread }>(first)
    const b = await data<{ thread: Thread }>(again)
    expect(b.thread.id).toBe(a.thread.id)
    expect(await db.supportThread.count({ where: { tenantId: tenantA } })).toBe(1)
    expect(alert).toHaveBeenCalledTimes(1)
  })

  it('two simultaneous opens with the same clientMessageId make one thread and one alert', async () => {
    const clientMessageId = cid()
    const send = () =>
      appAs('alice').request('/support/threads', json({ clientMessageId, body: 'double tap' }))
    const [a, b] = await Promise.all([send(), send()])
    expect([a.status, b.status].sort()).toEqual([200, 201])
    const ta = await data<{ thread: Thread }>(a)
    const tb = await data<{ thread: Thread }>(b)
    expect(ta.thread.id).toBe(tb.thread.id)
    expect(await db.supportThread.count({ where: { tenantId: tenantA } })).toBe(1)
    expect(await db.supportMessage.count({ where: { tenantId: tenantA } })).toBe(1)
    expect(alert).toHaveBeenCalledTimes(1)
  })

  it('validates the request', async () => {
    const badId = await appAs('alice').request(
      '/support/threads',
      json({ clientMessageId: 'x', body: 'hi' }),
    )
    expect(badId.status).toBe(400)
    expect(await codeOf(badId)).toBe('VALIDATION_ERROR')

    const empty = await open('alice', '   ')
    expect(empty.status).toBe(422)
    expect(await codeOf(empty)).toBe('SUPPORT_BODY_EMPTY')
  })

  it('lets every role open a thread, drivers included', async () => {
    expect((await open('driver')).status).toBe(201)
  })

  // -------------------------------------------------------------------------
  // Visibility: a thread belongs to its author only (D9)
  // -------------------------------------------------------------------------

  it('lists only the caller’s own threads, newest activity first', async () => {
    const t1 = await data<{ thread: Thread }>(await open('alice', 'first'))
    const t2 = await data<{ thread: Thread }>(await open('alice', 'second'))
    await open('bob', 'not yours')
    await open('carol', 'other tenant')

    const res = await appAs('alice').request('/support/threads')
    expect(res.status).toBe(200)
    const list = await data<Thread[]>(res)
    expect(list.map((t) => t.id)).toEqual([t2.thread.id, t1.thread.id])
  })

  it('answers 404 for a thread the caller did not open — same tenant or not', async () => {
    const t = await data<{ thread: Thread }>(await open('alice'))
    for (const who of ['bob', 'carol']) {
      const read = await appAs(who).request(`/support/threads/${t.thread.id}`)
      expect(read.status).toBe(404)
      expect(await codeOf(read)).toBe('SUPPORT_THREAD_NOT_FOUND')
      const post = await appAs(who).request(
        `/support/threads/${t.thread.id}/messages`,
        json({ clientMessageId: cid(), body: 'sneaky' }),
      )
      expect(post.status).toBe(404)
    }
    expect(await db.supportMessage.count({ where: { threadId: t.thread.id } })).toBe(1)
  })

  // -------------------------------------------------------------------------
  // Reading + unread
  // -------------------------------------------------------------------------

  it('reads a thread with every message, naming the operator only as "Pegasus support"', async () => {
    const t = await data<{ thread: Thread }>(await open('alice', 'help'))
    await operatorReply(t.thread.id, tenantA, 'On it')

    const res = await appAs('alice').request(`/support/threads/${t.thread.id}`)
    expect(res.status).toBe(200)
    const out = await data<{ thread: Thread; messages: Message[] }>(res)
    expect(out.messages.map((m) => [m.authorKind, m.body])).toEqual([
      ['customer', 'help'],
      ['operator', 'On it'],
    ])
    expect(out.messages[1]!.authorName).toBe('Pegasus support')
    expect(JSON.stringify(out)).not.toContain('op@example.com')
    expect(JSON.stringify(out)).not.toContain('op-sub')
  })

  it('marks an operator reply unread until the customer opens the thread', async () => {
    const t = await data<{ thread: Thread }>(await open('alice'))
    let list = await data<Thread[]>(await appAs('alice').request('/support/threads'))
    expect(list[0]!.unread).toBe(false)

    await operatorReply(t.thread.id, tenantA)
    list = await data<Thread[]>(await appAs('alice').request('/support/threads'))
    expect(list[0]!.unread).toBe(true)
    expect(list[0]!.status).toBe('awaiting_customer')

    await appAs('alice').request(`/support/threads/${t.thread.id}`)
    list = await data<Thread[]>(await appAs('alice').request('/support/threads'))
    expect(list[0]!.unread).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Posting a follow-up
  // -------------------------------------------------------------------------

  it('a customer reply puts the thread back on the operator and alerts once per burst', async () => {
    const t = await data<{ thread: Thread }>(await open('alice'))
    await operatorReply(t.thread.id, tenantA)
    alert.mockClear()

    const post = (body: string) =>
      appAs('alice').request(
        `/support/threads/${t.thread.id}/messages`,
        json({ clientMessageId: cid(), body }),
      )
    const r1 = await post('Here is more detail')
    expect(r1.status).toBe(201)
    expect((await data<Message>(r1)).authorKind).toBe('customer')
    expect(alert).toHaveBeenCalledTimes(1)
    expect(alert.mock.calls[0]![0]).toMatchObject({ isNewThread: false })

    // Still awaiting the operator and alerted moments ago: no second page.
    await post('And one more thing')
    expect(alert).toHaveBeenCalledTimes(1)

    const row = await db.supportThread.findUniqueOrThrow({ where: { id: t.thread.id } })
    expect(row.status).toBe('awaiting_operator')
    expect(row.lastAuthorKind).toBe('customer')
  })

  it('reopens a resolved thread when the customer writes again', async () => {
    const t = await data<{ thread: Thread }>(await open('alice'))
    await db.supportThread.update({ where: { id: t.thread.id }, data: { status: 'resolved' } })
    alert.mockClear()
    await appAs('alice').request(
      `/support/threads/${t.thread.id}/messages`,
      json({ clientMessageId: cid(), body: 'it broke again' }),
    )
    const row = await db.supportThread.findUniqueOrThrow({ where: { id: t.thread.id } })
    expect(row.status).toBe('awaiting_operator')
    expect(alert).toHaveBeenCalledTimes(1)
  })

  it('a resent follow-up is stored once', async () => {
    const t = await data<{ thread: Thread }>(await open('alice'))
    const clientMessageId = cid()
    const send = () =>
      appAs('alice').request(
        `/support/threads/${t.thread.id}/messages`,
        json({ clientMessageId, body: 'again' }),
      )
    expect((await send()).status).toBe(201)
    expect((await send()).status).toBe(200)
    expect(await db.supportMessage.count({ where: { threadId: t.thread.id } })).toBe(2)
  })

  it('still stores the message when the alert fails', async () => {
    alert.mockResolvedValue(false)
    const res = await open('alice')
    expect(res.status).toBe(201)
    const t = await data<{ thread: Thread }>(res)
    const row = await db.supportThread.findUniqueOrThrow({ where: { id: t.thread.id } })
    // Not stamped, so the next customer message tries again.
    expect(row.lastOperatorAlertAt).toBeNull()
  })

  it('starts one AI triage draft for the operator when it alerts, not on every message', async () => {
    process.env['SUPPORT_TRIAGE_ENABLED'] = 'true'
    process.env['SUPPORT_TRIAGE_FUNCTION_NAME'] = 'triage-fn'
    const invoke = invokeSupportTriage as unknown as Mock
    invoke.mockReset()
    invoke.mockResolvedValue(true)
    try {
      const t = await data<{ thread: Thread }>(await open('alice'))
      const drafts = await db.supportWorkItemDraft.findMany({ where: { threadId: t.thread.id } })
      expect(drafts).toHaveLength(1)
      expect(drafts[0]).toMatchObject({ status: 'pending', requestedBy: 'auto', tenantId: tenantA })
      expect(invoke).toHaveBeenCalledWith(drafts[0]!.id)

      // A follow-up inside the alert debounce starts nothing new.
      await appAs('alice').request(
        `/support/threads/${t.thread.id}/messages`,
        json({ clientMessageId: cid(), body: 'more' }),
      )
      expect(await db.supportWorkItemDraft.count({ where: { threadId: t.thread.id } })).toBe(1)
    } finally {
      delete process.env['SUPPORT_TRIAGE_ENABLED']
      delete process.env['SUPPORT_TRIAGE_FUNCTION_NAME']
    }
  })
})
