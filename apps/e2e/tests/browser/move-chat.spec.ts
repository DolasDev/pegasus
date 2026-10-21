import { test, expect, type Route } from '@playwright/test'

// ---------------------------------------------------------------------------
// Move chat page (/messages) — Playwright browser spec.
//
// Drives the real e2e-mode tenant-web build, with the chat API mocked through
// `page.route`. The local e2e stack can't host a real two-person chat: the
// SKIP_AUTH API has one synthetic identity and no legacy (pegII) database, and
// a room's first post must find its order there. So the "other session" is the
// mock adding a colleague's reply, which the page must pick up by polling.
// The server rules (access, idempotency, unread counts) are covered by
// apps/api/src/handlers/chat.test.ts against Postgres.
//
// Tagged @local-only: every chat call is mocked and the session is the e2e
// seam's, so it means nothing against a real staging API.
// ---------------------------------------------------------------------------

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')
test.skip(
  !process.env['WEB_URL'],
  'WEB_URL not set — skipping browser tests (serve the e2e-mode tenant-web build first)',
)

const WEB_URL = process.env['WEB_URL'] ?? 'http://localhost:4173'
const ORDER = 4242
const ME = 'me-user'

type Msg = {
  id: string
  clientMessageId: string
  body: string | null
  author: { id: string; name: string }
  mentionedUserIds: string[]
  createdAt: string
  deletedAt: string | null
}

const json = (route: Route, data: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ data }),
  })

test.describe('move chat @local-only', () => {
  test('post a message, see a colleague reply arrive, and clear the unread badge', async ({
    page,
  }) => {
    const messages: Msg[] = [
      {
        id: 'm-001',
        clientMessageId: 'seed-0001',
        body: 'Truck is loaded, leaving at 6',
        author: { id: 'ann', name: 'Ann Lee' },
        mentionedUserIds: [],
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        deletedAt: null,
      },
    ]
    let lastReadAt: string | null = null
    const posted: Array<{ clientMessageId: string; body: string }> = []

    const unread = () =>
      messages.filter((m) => m.author.id !== ME && (!lastReadAt || m.createdAt > lastReadAt)).length

    // The permissions call carries the caller's id and the capability that
    // shows Messages (rooms are legacy orders).
    await page.route('**/api/v1/me/permissions', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          roles: ['tenant_admin'],
          permissions: ['chat:read', 'chat:post'],
          capabilities: { longhaul: true, reporting: false },
          userId: ME,
        }),
      }),
    )

    await page.route('**/api/v1/chat/**', async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      const path = url.pathname
      const method = req.method()

      if (path === '/api/v1/chat/inbox') {
        const last = messages[messages.length - 1]!
        return json(route, [
          {
            room: {
              id: 'room-1',
              entityType: 'shipment',
              entityId: String(ORDER),
              lastMessageAt: last.createdAt,
            },
            lastMessage: {
              id: last.id,
              authorName: last.author.name,
              preview: last.body,
              createdAt: last.createdAt,
            },
            unreadCount: unread(),
            unreadMentionCount: 0,
            following: true,
            muted: false,
          },
        ])
      }
      if (path === '/api/v1/chat/summaries') {
        return json(route, [
          {
            orderNum: ORDER,
            shipperName: 'SMITH, JOHN',
            origin: 'Austin, TX',
            destination: 'Denver, CO',
            packDate: '2026-10-21',
            loadDate: null,
            deliveryDate: null,
          },
        ])
      }
      const room = `/api/v1/chat/rooms/shipment/${ORDER}`
      if (path === room) {
        return json(route, {
          room: {
            id: 'room-1',
            entityType: 'shipment',
            entityId: String(ORDER),
            lastMessageAt: null,
          },
          membership: { following: true, muted: false, lastReadAt },
          unreadCount: unread(),
        })
      }
      if (path === `${room}/mentionable`) {
        return json(route, [{ userId: 'ann', name: 'Ann Lee', kind: 'employee' }])
      }
      if (path === `${room}/read`) {
        lastReadAt = (req.postDataJSON() as { at: string }).at
        return json(route, { lastReadAt })
      }
      if (path === `${room}/messages` && method === 'POST') {
        const body = req.postDataJSON() as { clientMessageId: string; body: string }
        posted.push(body)
        const row: Msg = {
          id: `m-${String(messages.length + 1).padStart(3, '0')}`,
          clientMessageId: body.clientMessageId,
          body: body.body,
          author: { id: ME, name: 'Me' },
          mentionedUserIds: [],
          createdAt: new Date().toISOString(),
          deletedAt: null,
        }
        messages.push(row)
        return json(route, row, 201)
      }
      if (path === `${room}/messages`) {
        const after = url.searchParams.get('after')
        const at = after ? messages.findIndex((m) => m.id === after) : -1
        return json(route, after ? messages.slice(at + 1) : messages)
      }
      return route.fulfill({ status: 404, body: '{}' })
    })

    await page.goto(`${WEB_URL}/messages`)

    // The nav badge counts the unread message.
    const nav = page.getByRole('link', { name: /Messages/ })
    await expect(nav.getByLabel('1 unread messages')).toBeVisible()

    // The list shows the move with its shipper; opening it marks it read.
    await page.getByRole('button', { name: /#4242/ }).click()
    await expect(page).toHaveURL(new RegExp(`/messages/shipment/${ORDER}$`))
    const thread = page.getByRole('region', { name: `Chat for order ${ORDER}` })
    await expect(thread.getByText('Truck is loaded, leaving at 6', { exact: true })).toBeVisible()
    await expect(thread.getByRole('heading', { level: 2 })).toHaveText('#4242 · Smith, John')
    await expect(nav.getByLabel(/unread messages/)).toHaveCount(0)

    // Post: Enter sends, the message stays, and the composer clears.
    const box = thread.getByRole('textbox', { name: 'Message' })
    await box.fill('On my way to the warehouse')
    await box.press('Enter')
    await expect(thread.getByText('On my way to the warehouse', { exact: true })).toBeVisible()
    await expect(box).toHaveValue('')
    expect(posted).toHaveLength(1)
    expect(posted[0]!.clientMessageId).toMatch(/^[A-Za-z0-9_-]{8,64}$/)

    // A colleague replies from another session; the open room polls it in.
    messages.push({
      id: 'm-900',
      clientMessageId: 'other-session-1',
      body: 'Great, gate code is 1234',
      author: { id: 'ann', name: 'Ann Lee' },
      mentionedUserIds: [],
      createdAt: new Date(Date.now() + 1_000).toISOString(),
      deletedAt: null,
    })
    await expect(thread.getByText('Great, gate code is 1234', { exact: true })).toBeVisible({
      timeout: 10_000,
    })
  })
})
