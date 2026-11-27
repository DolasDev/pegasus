/**
 * Integration tests for /api/admin/support — the platform operator's inbox
 * across every tenant.
 *
 * Runs the real router against Postgres on the base client (as the admin
 * router does). The push forwarder kick is mocked. Requires a live PostgreSQL
 * database; skipped automatically when DATABASE_URL is not set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import { DomainError } from '@pegasus/domain'

import type * as SupportTriageInvoke from '../../lib/support-triage-invoke'

vi.mock('../../lib/push-forward-invoke', () => ({ kickPushForwarder: vi.fn() }))
vi.mock('../../lib/support-triage-invoke', async (orig) => ({
  ...(await orig<typeof SupportTriageInvoke>()),
  invokeSupportTriage: vi.fn(),
}))

import type { AdminEnv } from '../../types'
import { db } from '../../db'
import { kickPushForwarder } from '../../lib/push-forward-invoke'
import { invokeSupportTriage } from '../../lib/support-triage-invoke'
import { adminSupportRouter } from './support'

const hasDb = Boolean(process.env['DATABASE_URL'])
const kick = kickPushForwarder as unknown as Mock

const SLUG_A = 'test-admin-support-a'
const SLUG_B = 'test-admin-support-b'
let tenantA: string
let tenantB: string
let alice: string
let carol: string

function app() {
  const a = new Hono<AdminEnv>()
  a.onError((err, c) =>
    err instanceof DomainError
      ? c.json({ error: err.message, code: err.code }, 422)
      : c.json({ error: 'An unexpected error occurred', code: 'INTERNAL_ERROR' }, 500),
  )
  a.use('*', async (c, next) => {
    c.set('adminSub', 'op-sub-1')
    c.set('adminEmail', 'steve@example.com')
    await next()
  })
  a.route('/support', adminSupportRouter)
  return a
}

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

let seq = 0
const cid = () => `op-msg-${++seq}-${Date.now()}`

async function data<T>(res: Response): Promise<T> {
  return ((await res.json()) as { data: T }).data
}
async function codeOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { code?: string }).code
}

/** A customer-opened thread, written straight to the tables (the tenant API has its own tests). */
async function customerThread(tenantId: string, userId: string, subject: string, at: Date) {
  const t = await db.supportThread.create({
    data: {
      tenantId,
      openedByUserId: userId,
      openClientMessageId: cid(),
      subject,
      lastMessageAt: at,
      userAgent: 'Mozilla/5.0',
      appVersion: '1.2.3',
    },
  })
  await db.supportMessage.create({
    data: {
      tenantId,
      threadId: t.id,
      authorKind: 'customer',
      authorUserId: userId,
      clientMessageId: cid(),
      body: `${subject} — details`,
      createdAt: at,
    },
  })
  return t
}

type InboxThread = {
  id: string
  subject: string
  status: string
  unread: boolean
  tenant: { id: string; name: string }
  openedBy: { id: string; name: string; email: string }
}

async function wipeTenant(tenantId: string) {
  await db.notification.deleteMany({ where: { tenantId } })
  await db.pushNotificationOutbox.deleteMany({ where: { tenantId } })
  await db.notificationPreference.deleteMany({ where: { tenantId } })
  await db.supportMessage.deleteMany({ where: { tenantId } })
  await db.supportThread.deleteMany({ where: { tenantId } })
  await db.tenantUser.deleteMany({ where: { tenantId } })
}

afterAll(async () => {
  if (!hasDb) return
  for (const t of [tenantA, tenantB].filter(Boolean)) await wipeTenant(t).catch(() => undefined)
  delete process.env['SUPPORT_ENABLED']
  delete process.env['SUPPORT_TRIAGE_ENABLED']
  delete process.env['SUPPORT_TRIAGE_FUNCTION_NAME']
  await db.$disconnect()
})

describe.skipIf(!hasDb)('/api/admin/support (integration)', () => {
  beforeAll(async () => {
    const upsert = (slug: string, name: string) =>
      db.tenant.upsert({ where: { slug }, create: { name, slug }, update: { name } })
    tenantA = (await upsert(SLUG_A, 'Acme Movers')).id
    tenantB = (await upsert(SLUG_B, 'Bravo Van Lines')).id
  })

  beforeEach(async () => {
    process.env['SUPPORT_ENABLED'] = 'true'
    kick.mockReset()
    kick.mockResolvedValue(true)
    await wipeTenant(tenantA)
    await wipeTenant(tenantB)
    alice = (
      await db.tenantUser.create({
        data: {
          tenantId: tenantA,
          email: 'alice@acme.test',
          roleNames: ['sales'],
          status: 'ACTIVE',
        },
      })
    ).id
    carol = (
      await db.tenantUser.create({
        data: {
          tenantId: tenantB,
          email: 'carol@bravo.test',
          roleNames: ['sales'],
          status: 'ACTIVE',
        },
      })
    ).id
  })

  it('answers 404 on every route when SUPPORT_ENABLED is off', async () => {
    delete process.env['SUPPORT_ENABLED']
    const res = await app().request('/support/threads')
    expect(res.status).toBe(404)
    expect(await codeOf(res)).toBe('NOT_FOUND')
  })

  it('lists threads across tenants, newest activity first, with who and where', async () => {
    const t1 = await customerThread(tenantA, alice, 'Older', new Date(Date.now() - 60_000))
    const t2 = await customerThread(tenantB, carol, 'Newer', new Date())

    const list = await data<InboxThread[]>(await app().request('/support/threads'))
    const ours = list.filter((t) => [t1.id, t2.id].includes(t.id))
    expect(ours.map((t) => t.id)).toEqual([t2.id, t1.id])
    expect(ours[0]!.tenant).toEqual({ id: tenantB, name: 'Bravo Van Lines' })
    expect(ours[0]!.openedBy.email).toBe('carol@bravo.test')
    expect(ours[0]!.unread).toBe(true)
  })

  it('filters by status, with "open" meaning not resolved', async () => {
    const t1 = await customerThread(tenantA, alice, 'A', new Date())
    const t2 = await customerThread(tenantA, alice, 'B', new Date())
    await db.supportThread.update({ where: { id: t2.id }, data: { status: 'resolved' } })

    const open = await data<InboxThread[]>(await app().request('/support/threads?status=open'))
    expect(open.map((t) => t.id)).toContain(t1.id)
    expect(open.map((t) => t.id)).not.toContain(t2.id)
    const resolved = await data<InboxThread[]>(
      await app().request('/support/threads?status=resolved'),
    )
    // Other test files share the database: look only at this file's tenants.
    const mine = resolved.filter((t) => [tenantA, tenantB].includes(t.tenant.id))
    expect(mine.map((t) => t.id)).toEqual([t2.id])

    const bad = await app().request('/support/threads?status=nope')
    expect(bad.status).toBe(400)
  })

  it('reads a thread with its diagnostics and marks it read for the operator', async () => {
    const t = await customerThread(tenantA, alice, 'Help', new Date())
    const res = await app().request(`/support/threads/${t.id}`)
    expect(res.status).toBe(200)
    const out = await data<{
      thread: InboxThread & { userAgent: string; appVersion: string }
      messages: Array<{ authorKind: string; authorName: string; body: string }>
    }>(res)
    expect(out.thread.userAgent).toBe('Mozilla/5.0')
    expect(out.thread.appVersion).toBe('1.2.3')
    expect(out.messages).toHaveLength(1)
    expect(out.messages[0]!.authorName).toBe('alice@acme.test')

    const list = await data<InboxThread[]>(await app().request('/support/threads'))
    expect(list.find((x) => x.id === t.id)!.unread).toBe(false)
  })

  it('answers 404 for an unknown thread', async () => {
    const res = await app().request('/support/threads/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
    expect(await codeOf(res)).toBe('SUPPORT_THREAD_NOT_FOUND')
  })

  it('replies as the operator: waits on the customer and notifies them in their feed', async () => {
    const t = await customerThread(tenantA, alice, 'Invoice totals', new Date())
    const clientMessageId = cid()
    const res = await app().request(
      `/support/threads/${t.id}/messages`,
      json({ clientMessageId, body: 'Fixed — please refresh' }),
    )
    expect(res.status).toBe(201)
    const m = await data<{ authorKind: string; authorName: string }>(res)
    expect(m.authorKind).toBe('operator')
    expect(m.authorName).toBe('steve@example.com')

    const row = await db.supportMessage.findFirstOrThrow({ where: { clientMessageId } })
    expect(row.operatorSub).toBe('op-sub-1')
    expect(row.tenantId).toBe(tenantA)
    const thread = await db.supportThread.findUniqueOrThrow({ where: { id: t.id } })
    expect(thread.status).toBe('awaiting_customer')
    expect(thread.lastAuthorKind).toBe('operator')

    const feed = await db.notification.findMany({ where: { tenantId: tenantA } })
    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({
      type: 'support.reply',
      recipientUserId: alice,
      entityType: 'support_thread',
      entityId: t.id,
      // `type` in data is what the web Activity feed and the phone route on.
      data: { type: 'support.reply', route: `/support/${t.id}`, threadId: t.id },
    })
    // support.reply defaults to the feed: no push queued, no kick.
    expect(kick).not.toHaveBeenCalled()

    // A resend is stored once and notifies once.
    const again = await app().request(
      `/support/threads/${t.id}/messages`,
      json({ clientMessageId, body: 'Fixed — please refresh' }),
    )
    expect(again.status).toBe(200)
    expect(await db.supportMessage.count({ where: { threadId: t.id } })).toBe(2)
    expect(await db.notification.count({ where: { tenantId: tenantA } })).toBe(1)
  })

  it('pushes the reply when the customer chose push for support replies', async () => {
    const t = await customerThread(tenantA, alice, 'Push me', new Date())
    await db.notificationPreference.create({
      data: { tenantId: tenantA, userId: alice, type: 'support.reply', channel: 'push' },
    })
    await app().request(
      `/support/threads/${t.id}/messages`,
      json({ clientMessageId: cid(), body: 'On it' }),
    )
    expect(await db.pushNotificationOutbox.count({ where: { tenantId: tenantA } })).toBe(1)
    expect(kick).toHaveBeenCalledTimes(1)
  })

  it('validates a reply', async () => {
    const t = await customerThread(tenantA, alice, 'X', new Date())
    const bad = await app().request(
      `/support/threads/${t.id}/messages`,
      json({ clientMessageId: 'x', body: 'hi' }),
    )
    expect(bad.status).toBe(400)
    const empty = await app().request(
      `/support/threads/${t.id}/messages`,
      json({ clientMessageId: cid(), body: '' }),
    )
    expect(empty.status).toBe(422)
    expect(await codeOf(empty)).toBe('SUPPORT_BODY_EMPTY')
  })

  it('sets a thread status', async () => {
    const t = await customerThread(tenantA, alice, 'Done?', new Date())
    const res = await app().request(
      `/support/threads/${t.id}`,
      json({ status: 'resolved' }, 'PATCH'),
    )
    expect(res.status).toBe(200)
    expect((await data<{ status: string }>(res)).status).toBe('resolved')

    const bad = await app().request(`/support/threads/${t.id}`, json({ status: 'open' }, 'PATCH'))
    expect(bad.status).toBe(400)
    expect(await codeOf(bad)).toBe('VALIDATION_ERROR')
  })

  describe('AI triage drafts', () => {
    type Draft = {
      id: string
      status: string
      kind: string | null
      suggestedReply: string | null
      error: string | null
      stale: boolean
      requestedBy: string
    }
    type Detail = { triage: { enabled: boolean; draft: Draft | null } }
    const invoke = invokeSupportTriage as unknown as Mock

    beforeEach(() => {
      process.env['SUPPORT_TRIAGE_ENABLED'] = 'true'
      process.env['SUPPORT_TRIAGE_FUNCTION_NAME'] = 'triage-fn'
      invoke.mockReset()
      invoke.mockResolvedValue(true)
    })

    it('is off by default: the detail says so and the routes answer 404', async () => {
      delete process.env['SUPPORT_TRIAGE_ENABLED']
      const t = await customerThread(tenantA, alice, 'Off', new Date())
      const detail = await data<Detail>(await app().request(`/support/threads/${t.id}`))
      expect(detail.triage).toEqual({ enabled: false, draft: null })
      const res = await app().request(`/support/threads/${t.id}/drafts`, json({}))
      expect(res.status).toBe(404)
      expect(await codeOf(res)).toBe('SUPPORT_TRIAGE_DISABLED')
    })

    it('starts a draft, returns the same one while it is in flight, and shows it on the thread', async () => {
      const t = await customerThread(tenantA, alice, 'Draft me', new Date())
      const first = await app().request(`/support/threads/${t.id}/drafts`, json({}))
      expect(first.status).toBe(202)
      const d1 = await data<Draft>(first)
      expect(d1.status).toBe('pending')
      expect(d1.requestedBy).toBe('steve@example.com')
      expect(invoke).toHaveBeenCalledWith(d1.id)

      const again = await app().request(`/support/threads/${t.id}/drafts`, json({}))
      expect(again.status).toBe(200)
      expect((await data<Draft>(again)).id).toBe(d1.id)

      const detail = await data<Detail>(await app().request(`/support/threads/${t.id}`))
      expect(detail.triage.enabled).toBe(true)
      expect(detail.triage.draft?.id).toBe(d1.id)
    })

    it('404s a draft for an unknown thread', async () => {
      const res = await app().request(
        '/support/threads/00000000-0000-0000-0000-000000000000/drafts',
        json({}),
      )
      expect(res.status).toBe(404)
    })

    it('marks a ready draft stale when messages arrived after it was built', async () => {
      const at = new Date(Date.now() - 60_000)
      const t = await customerThread(tenantA, alice, 'Stale', at)
      await db.supportWorkItemDraft.create({
        data: {
          tenantId: tenantA,
          threadId: t.id,
          status: 'ready',
          requestedBy: 'auto',
          kind: 'question',
          suggestedReply: 'Try the Export button.',
          throughMessageAt: at,
        },
      })
      const before = await data<Detail>(await app().request(`/support/threads/${t.id}`))
      expect(before.triage.draft).toMatchObject({ status: 'ready', stale: false })

      await db.supportMessage.create({
        data: {
          tenantId: tenantA,
          threadId: t.id,
          authorKind: 'customer',
          authorUserId: alice,
          clientMessageId: cid(),
          body: 'Also, it is still broken',
        },
      })
      const after = await data<Detail>(await app().request(`/support/threads/${t.id}`))
      expect(after.triage.draft?.stale).toBe(true)
    })

    it('does not call a draft stale because the operator replied (e.g. sent its suggestion)', async () => {
      const at = new Date(Date.now() - 60_000)
      const t = await customerThread(tenantA, alice, 'Answered', at)
      await db.supportWorkItemDraft.create({
        data: {
          tenantId: tenantA,
          threadId: t.id,
          status: 'ready',
          requestedBy: 'auto',
          kind: 'question',
          suggestedReply: 'Try the Export button.',
          throughMessageAt: at,
        },
      })
      await app().request(
        `/support/threads/${t.id}/messages`,
        json({ clientMessageId: cid(), body: 'Try the Export button.' }),
      )
      const detail = await data<Detail>(await app().request(`/support/threads/${t.id}`))
      expect(detail.triage.draft?.stale).toBe(false)
    })

    it('reads a lost in-flight draft as failed, and a new request starts a fresh one', async () => {
      const t = await customerThread(tenantA, alice, 'Lost', new Date())
      const old = await db.supportWorkItemDraft.create({
        data: {
          tenantId: tenantA,
          threadId: t.id,
          status: 'pending',
          requestedBy: 'auto',
          createdAt: new Date(Date.now() - 10 * 60_000),
        },
      })
      const detail = await data<Detail>(await app().request(`/support/threads/${t.id}`))
      expect(detail.triage.draft).toMatchObject({ id: old.id, status: 'failed' })
      expect(detail.triage.draft?.error).toMatch(/did not finish/)

      const res = await app().request(`/support/threads/${t.id}/drafts`, json({}))
      expect(res.status).toBe(202)
      expect((await data<Draft>(res)).id).not.toBe(old.id)
    })

    it('dismisses a draft, only through its own thread', async () => {
      const t = await customerThread(tenantA, alice, 'Dismiss', new Date())
      const other = await customerThread(tenantB, carol, 'Other', new Date())
      const d = await data<Draft>(await app().request(`/support/threads/${t.id}/drafts`, json({})))

      const wrong = await app().request(
        `/support/threads/${other.id}/drafts/${d.id}/dismiss`,
        json({}),
      )
      expect(wrong.status).toBe(404)
      expect(await codeOf(wrong)).toBe('SUPPORT_DRAFT_NOT_FOUND')

      const ok = await app().request(`/support/threads/${t.id}/drafts/${d.id}/dismiss`, json({}))
      expect(ok.status).toBe(200)
      expect((await data<Draft>(ok)).status).toBe('dismissed')
    })
  })
})
