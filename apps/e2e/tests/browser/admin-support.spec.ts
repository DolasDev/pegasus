import { test, expect, type Route } from '@playwright/test'
import { seedAdminAuth } from '../../fixtures/auth'

// ---------------------------------------------------------------------------
// Admin-web support inbox — Playwright browser spec, at a phone viewport
// (Steve answers from the alert email on his phone).
//
// Tagged `@local-only`: every backend call is mocked via `page.route` and the
// Cognito session is faked via `seedAdminAuth`, like admin-vpn-diagnose.spec.ts.
// Keyed on ADMIN_WEB_URL (not WEB_URL), which PR CI points at tenant-web.
// ---------------------------------------------------------------------------

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')
test.skip(
  !process.env['ADMIN_WEB_URL'],
  'ADMIN_WEB_URL not set — skipping browser tests (start admin-web dev server first)',
)

const ADMIN_WEB_URL = process.env['ADMIN_WEB_URL'] ?? 'http://localhost:5174'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const json = (route: Route, data: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ data }) })

function fixtures() {
  const now = new Date().toISOString()
  const thread = {
    id: 'th-1',
    subject: 'Trip dates show the wrong day',
    status: 'awaiting_operator' as 'awaiting_operator' | 'awaiting_customer' | 'resolved',
    lastMessageAt: now,
    lastAuthorKind: 'customer' as 'customer' | 'operator',
    createdAt: now,
    unread: true,
    tenant: { id: 'ten-1', name: 'Acme Moving' },
    openedBy: { id: 'u-1', name: 'Ann Lee', email: 'ann@acme.example' },
  }
  const messages = [
    {
      id: 'm-1',
      clientMessageId: 'cust-0001',
      authorKind: 'customer' as 'customer' | 'operator',
      authorName: 'Ann Lee',
      body: 'Trip 7 shows Tuesday, it should be Monday.',
      createdAt: now,
    },
  ]
  return { thread, messages }
}

test.describe('@local-only admin-web support inbox', () => {
  test('reply to a thread and resolve it from a phone', async ({ page }) => {
    await seedAdminAuth(page)
    const { thread, messages } = fixtures()
    const writes: Array<{ method: string; body: Record<string, unknown> }> = []

    await page.route('**/api/admin/support/**', async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      const method = req.method()
      if (url.pathname === '/api/admin/support/threads') {
        const status = url.searchParams.get('status')
        const visible =
          status === 'open' ? thread.status !== 'resolved' : !status || status === thread.status
        return json(route, visible ? [thread] : [])
      }
      if (url.pathname === '/api/admin/support/threads/th-1/messages' && method === 'POST') {
        const body = req.postDataJSON() as { clientMessageId: string; body: string }
        writes.push({ method, body })
        const m = {
          id: `m-${messages.length + 1}`,
          clientMessageId: body.clientMessageId,
          authorKind: 'operator' as const,
          authorName: 'steve@example.test',
          body: body.body,
          createdAt: new Date().toISOString(),
        }
        messages.push(m)
        thread.status = 'awaiting_customer'
        thread.lastAuthorKind = 'operator'
        return json(route, m, 201)
      }
      if (url.pathname === '/api/admin/support/threads/th-1' && method === 'PATCH') {
        const body = req.postDataJSON() as { status: typeof thread.status }
        writes.push({ method, body })
        thread.status = body.status
        return json(route, { ...thread })
      }
      if (url.pathname === '/api/admin/support/threads/th-1') {
        thread.unread = false
        return json(route, {
          thread: {
            ...thread,
            pageUrl: 'https://app.example/driver-planning/trips/7',
            userAgent: 'Mozilla/5.0 (iPhone)',
            appVersion: null,
          },
          messages,
        })
      }
      return route.fulfill({ status: 404, body: '{}' })
    })

    await page.goto(`${ADMIN_WEB_URL}/support`)
    await expect(page.getByRole('heading', { name: 'Support' })).toBeVisible()
    // The nav fits the phone header (it wraps instead of overflowing).
    await expect(page.getByRole('link', { name: 'Support', exact: true })).toBeVisible()
    const row = page.getByRole('link', { name: /Trip dates show the wrong day/ })
    await expect(row).toContainText('Acme Moving · Ann Lee')
    await row.click()

    await expect(page).toHaveURL(/\/support\/th-1$/)
    await expect(page.getByText('Trip 7 shows Tuesday, it should be Monday.')).toBeVisible()
    await expect(page.getByText('https://app.example/driver-planning/trips/7')).toBeVisible()

    await page.getByLabel('Reply').fill('Thanks, looking at trip 7 now.')
    await page.getByRole('button', { name: 'Send reply' }).click()
    await expect(page.getByText('Thanks, looking at trip 7 now.')).toBeVisible()
    await expect(page.getByLabel('Reply')).toHaveValue('')
    await expect(page.getByText('Waiting on customer')).toBeVisible()

    await page.getByRole('button', { name: 'Mark resolved' }).click()
    await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible()
    expect(writes.map((w) => w.method)).toEqual(['POST', 'PATCH'])
    expect(writes[1]!.body).toEqual({ status: 'resolved' })

    // No sideways scrolling at phone width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('the alert email’s thread link survives sign-in', async ({ page }) => {
    // Not signed in: the guard bounces to /login and remembers the thread.
    await page.goto(`${ADMIN_WEB_URL}/support/th-1`)
    await expect(page).toHaveURL(/\/login$/)
    expect(await page.evaluate(() => sessionStorage.getItem('pegasus_admin_return_to'))).toBe(
      '/support/th-1',
    )

    // Signed in (seeded the way a real login stores tokens), /login forwards
    // to the remembered page instead of the tenants list.
    const { thread, messages } = fixtures()
    await page.route('**/api/admin/support/**', (route) =>
      json(route, {
        thread: { ...thread, pageUrl: null, userAgent: null, appVersion: null },
        messages,
      }),
    )
    await page.evaluate(() => {
      sessionStorage.setItem('pegasus_admin_access_token', 'e2e-fake-access-token')
      sessionStorage.setItem('pegasus_admin_id_token', 'e2e-fake-id-token')
      sessionStorage.setItem('pegasus_admin_refresh_token', 'e2e-fake-refresh-token')
    })
    await page.goto(`${ADMIN_WEB_URL}/login`)
    await expect(page).toHaveURL(/\/support\/th-1$/)
    await expect(page.getByText('Trip 7 shows Tuesday, it should be Monday.')).toBeVisible()
  })
})
