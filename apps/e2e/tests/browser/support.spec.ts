import { test, expect, type Route } from '@playwright/test'

// ---------------------------------------------------------------------------
// Help (support channel) in tenant-web — Playwright browser spec.
//
// Drives the real e2e-mode tenant-web build with the support API mocked through
// `page.route`, like move-chat.spec.ts. The operator's reply is the mock adding
// a message, which the open thread must pick up by polling. The server rules
// (own threads only, idempotent open, alerts, status) are covered against
// Postgres by apps/api/src/handlers/support.test.ts, admin/support.test.ts and
// tests/api/support.spec.ts; the operator side by admin-support.spec.ts.
//
// Tagged @local-only: every support call is mocked and the session is the e2e
// seam's, so it means nothing against a real staging API.
// ---------------------------------------------------------------------------

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')
test.skip(
  !process.env['WEB_URL'],
  'WEB_URL not set — skipping browser tests (serve the e2e-mode tenant-web build first)',
)

const WEB_URL = process.env['WEB_URL'] ?? 'http://localhost:4173'

type Thread = {
  id: string
  subject: string
  status: 'awaiting_operator' | 'awaiting_customer' | 'resolved'
  lastMessageAt: string
  createdAt: string
  unread: boolean
  pageUrl: string | null
}
type Msg = {
  id: string
  clientMessageId: string
  authorKind: 'customer' | 'operator'
  authorName: string
  body: string
  createdAt: string
}

const json = (route: Route, data: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ data }) })

test.describe('support channel @local-only', () => {
  test('open a request from Help, get Pegasus support’s reply, and answer it', async ({ page }) => {
    const now = () => new Date().toISOString()
    const threads: Thread[] = [
      {
        id: 'th-old',
        subject: 'Invoice totals look off',
        status: 'awaiting_customer',
        lastMessageAt: now(),
        createdAt: now(),
        unread: true,
        pageUrl: null,
      },
    ]
    const messages = new Map<string, Msg[]>([
      [
        'th-old',
        [
          {
            id: 'm-old',
            clientMessageId: 'seed-old-1',
            authorKind: 'operator',
            authorName: 'Pegasus support',
            body: 'Fixed, please check again',
            createdAt: now(),
          },
        ],
      ],
    ])
    const opened: Array<Record<string, unknown>> = []

    await page.route('**/api/v1/me/permissions', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          roles: ['tenant_admin'],
          permissions: ['support:read', 'support:post'],
          capabilities: { longhaul: false, reporting: false, support: true },
          userId: 'me-user',
        }),
      }),
    )

    await page.route('**/api/v1/support/**', async (route) => {
      const req = route.request()
      const path = new URL(req.url()).pathname
      const method = req.method()

      if (path === '/api/v1/support/threads' && method === 'GET') return json(route, threads)
      if (path === '/api/v1/support/threads' && method === 'POST') {
        const body = req.postDataJSON() as Record<string, unknown>
        opened.push(body)
        const t: Thread = {
          id: 'th-new',
          subject: String(body['subject']),
          status: 'awaiting_operator',
          lastMessageAt: now(),
          createdAt: now(),
          unread: false,
          pageUrl: null,
        }
        const m: Msg = {
          id: 'm-new-1',
          clientMessageId: String(body['clientMessageId']),
          authorKind: 'customer',
          authorName: 'Me',
          body: String(body['body']),
          createdAt: now(),
        }
        threads.unshift(t)
        messages.set(t.id, [m])
        return json(route, { thread: t, message: m }, 201)
      }
      const match = /^\/api\/v1\/support\/threads\/([^/]+)(\/messages)?$/.exec(path)
      const t = match ? threads.find((x) => x.id === match[1]) : undefined
      if (!t) return route.fulfill({ status: 404, body: '{}' })
      if (match?.[2] && method === 'POST') {
        const body = req.postDataJSON() as { clientMessageId: string; body: string }
        const m: Msg = {
          id: `m-${Date.now()}`,
          clientMessageId: body.clientMessageId,
          authorKind: 'customer',
          authorName: 'Me',
          body: body.body,
          createdAt: now(),
        }
        messages.get(t.id)!.push(m)
        t.status = 'awaiting_operator'
        return json(route, m, 201)
      }
      t.unread = false
      return json(route, { thread: t, messages: messages.get(t.id) ?? [] })
    })

    // Start somewhere else: the request should carry this page, not /support.
    await page.goto(`${WEB_URL}/dashboard`)

    // Help is in the nav, with a badge for the unread reply on the old request.
    const help = page.getByRole('link', { name: /Help/ })
    await expect(help.getByLabel('1 unread support reply')).toBeVisible()
    await help.click()
    await expect(page).toHaveURL(/\/support$/)
    await expect(page.getByText('Invoice totals look off')).toBeVisible()

    // New request: subject + message, then Send opens the thread.
    await page.getByRole('button', { name: /New request/ }).click()
    await page.getByLabel('Subject').fill('Trip dates show the wrong day')
    await page.getByLabel('What’s going on?').fill('Trip 7 shows Tuesday, it should be Monday.')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page).toHaveURL(/\/support\/th-new$/)
    await expect(page.getByText('Trip 7 shows Tuesday, it should be Monday.')).toBeVisible()

    expect(opened).toHaveLength(1)
    expect(opened[0]!['clientMessageId']).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    const context = opened[0]!['context'] as { pageUrl?: string; userAgent?: string }
    expect(context.pageUrl).toMatch(/\/dashboard$/)
    expect(context.userAgent).toBeTruthy()

    // Pegasus support replies from admin-web; the open thread polls it in.
    messages.get('th-new')!.push({
      id: 'm-new-2',
      clientMessageId: 'operator-reply-1',
      authorKind: 'operator',
      authorName: 'Pegasus support',
      body: 'Thanks, looking at trip 7 now.',
      createdAt: new Date(Date.now() + 1_000).toISOString(),
    })
    threads[0]!.status = 'awaiting_customer'
    await expect(page.getByText('Thanks, looking at trip 7 now.')).toBeVisible({ timeout: 15_000 })
    // The open thread's header (not the old request's list row) shows the new status.
    await expect(
      page.getByRole('heading', { name: 'Trip dates show the wrong day', level: 2 }).locator('..'),
    ).toContainText('Support replied', { timeout: 15_000 })

    // Answer it: Enter sends and the box clears.
    const reply = page.getByRole('textbox', { name: 'Reply' })
    await reply.fill('It is the Monday load.')
    await reply.press('Enter')
    await expect(page.getByText('It is the Monday load.')).toBeVisible()
    await expect(reply).toHaveValue('')
  })
})
