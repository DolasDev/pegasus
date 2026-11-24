// ---------------------------------------------------------------------------
// E2E coverage for the support channel (plans/in-progress/support-channel.md,
// Phase 1a): the real HTTP → SKIP_AUTH → Cedar → Prisma path for a tenant user's
// own threads, and the admin inbox sitting behind PLATFORM_ADMIN auth.
//
//   1. POST /api/v1/support/threads opens a thread (201) and a resend is a
//      replay (200, same thread).
//   2. GET  /api/v1/support/threads lists it; GET /threads/:id reads it.
//   3. POST /threads/:id/messages adds a follow-up.
//   4. A thread opened by someone else answers 404.
//   5. /api/admin/support refuses a request with no admin token (401).
//
// SKIP_AUTH acts as the synthetic user `skip-auth-user`, which has no
// tenant_users row by default — a support thread needs one (FK), so the spec
// seeds it and removes it again if it created it. @local-only: DB-seeded.
// Handler behavior in depth (alerts, debounce, unread, admin replies) lives in
// apps/api/src/handlers/support.test.ts and handlers/admin/support.test.ts.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import { test, expect } from '../../fixtures'

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')

const API_BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001'
const DATABASE_URL = process.env['DATABASE_URL']
const TENANT_ID = process.env['TEST_TENANT_ID'] ?? 'e2e00000-0000-0000-0000-000000000001'
const SKIP_AUTH_USER = 'skip-auth-user'

type PrismaLike = {
  $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<number>
  $disconnect: () => Promise<void>
}

async function getPrisma(): Promise<PrismaLike> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma 7 ESM export compat (mirrors other specs).
  const mod: Record<string, any> = await import('@prisma/client')
  const PrismaClient = mod['PrismaClient'] ?? mod['default']?.PrismaClient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapter ESM export compat
  const adapterMod: Record<string, any> = await import('@prisma/adapter-pg')
  const PrismaPg = adapterMod['PrismaPg'] ?? adapterMod['default']?.PrismaPg
  const adapter = new PrismaPg({ connectionString: DATABASE_URL })
  return new PrismaClient({ adapter }) as PrismaLike
}

const cid = () => `e2e-support-${crypto.randomBytes(6).toString('hex')}`

test.describe('@local-only support channel', () => {
  let prisma: PrismaLike
  let createdUser = false
  const otherUserId = `e2e-support-other-${crypto.randomBytes(4).toString('hex')}`

  test.beforeAll(async () => {
    prisma = await getPrisma()
    createdUser =
      (await prisma.$executeRawUnsafe(
        `INSERT INTO public.tenant_users (id, tenant_id, email, role_names, status, invited_at, activated_at)
         VALUES ($1, $2, $3, ARRAY['tenant_admin'], 'ACTIVE'::"TenantUserStatus", NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        SKIP_AUTH_USER,
        TENANT_ID,
        'skip-auth-user@e2e.invalid',
      )) === 1
    await prisma.$executeRawUnsafe(
      `INSERT INTO public.tenant_users (id, tenant_id, email, role_names, status, invited_at, activated_at)
       VALUES ($1, $2, $3, ARRAY['sales'], 'ACTIVE'::"TenantUserStatus", NOW(), NOW())`,
      otherUserId,
      TENANT_ID,
      `${otherUserId}@e2e.invalid`,
    )
  })

  test.afterAll(async () => {
    for (const userId of [SKIP_AUTH_USER, otherUserId]) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM public.support_messages WHERE thread_id IN
           (SELECT id FROM public.support_threads WHERE opened_by_user_id = $1)`,
        userId,
      )
      await prisma.$executeRawUnsafe(
        `DELETE FROM public.support_threads WHERE opened_by_user_id = $1`,
        userId,
      )
    }
    await prisma.$executeRawUnsafe(`DELETE FROM public.tenant_users WHERE id = $1`, otherUserId)
    if (createdUser) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM public.tenant_users WHERE id = $1`,
        SKIP_AUTH_USER,
      )
    }
    await prisma.$disconnect()
  })

  test('opens, lists, reads and follows up on the caller’s own thread', async ({ apiFetch }) => {
    const first = cid()
    const opened = await apiFetch('/api/v1/support/threads', {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: first,
        body: 'E2E: the planning board will not load\nIt spins forever',
        context: { pageUrl: 'https://app.example.com/planning', appVersion: 'e2e' },
      }),
    })
    expect(opened.status).toBe(201)
    const { data } = (await opened.json()) as {
      data: { thread: { id: string; subject: string; status: string } }
    }
    expect(data.thread.subject).toBe('E2E: the planning board will not load')
    expect(data.thread.status).toBe('awaiting_operator')
    const threadId = data.thread.id

    const replay = await apiFetch('/api/v1/support/threads', {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: first,
        body: 'E2E: the planning board will not load',
      }),
    })
    expect(replay.status).toBe(200)
    expect(((await replay.json()) as { data: { thread: { id: string } } }).data.thread.id).toBe(
      threadId,
    )

    const list = await apiFetch('/api/v1/support/threads')
    expect(list.status).toBe(200)
    const threads = ((await list.json()) as { data: Array<{ id: string }> }).data
    expect(threads.map((t) => t.id)).toContain(threadId)

    const follow = await apiFetch(`/api/v1/support/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ clientMessageId: cid(), body: 'Still broken after refresh' }),
    })
    expect(follow.status).toBe(201)

    const read = await apiFetch(`/api/v1/support/threads/${threadId}`)
    expect(read.status).toBe(200)
    const thread = (await read.json()) as { data: { messages: Array<{ body: string }> } }
    expect(thread.data.messages.map((m) => m.body)).toEqual([
      'E2E: the planning board will not load\nIt spins forever',
      'Still broken after refresh',
    ])
  })

  test('another user’s thread answers 404', async ({ apiFetch }) => {
    const id = crypto.randomUUID()
    await prisma.$executeRawUnsafe(
      `INSERT INTO public.support_threads
         (id, tenant_id, opened_by_user_id, open_client_message_id, subject, updated_at)
       VALUES ($1, $2, $3, $4, 'Not yours', NOW())`,
      id,
      TENANT_ID,
      otherUserId,
      cid(),
    )
    const res = await apiFetch(`/api/v1/support/threads/${id}`)
    expect(res.status).toBe(404)
    expect(((await res.json()) as { code: string }).code).toBe('SUPPORT_THREAD_NOT_FOUND')
  })

  test('the admin inbox requires a platform-admin token', async () => {
    const res = await fetch(`${API_BASE}/api/admin/support/threads`)
    expect(res.status).toBe(401)
  })
})
