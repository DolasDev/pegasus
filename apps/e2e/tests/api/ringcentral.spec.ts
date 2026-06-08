import { test, expect } from '../../fixtures'

// HTTP-level acceptance for the RingCentral message-capture endpoints. These
// assert the public contract that does NOT depend on the integration being
// enabled or on any seeded connection/subscription: the webhook is mounted
// pre-tenant (unauthenticated) and its handshake / validation / unknown-sub
// paths are flag-independent, and the OAuth callback is reachable. The full
// connected flow (live OAuth + a real subscription) needs RingCentral creds
// and is out of scope for CI — it is covered by unit/integration tests.

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')

const WEBHOOK = '/api/integrations/ringcentral/webhook'
const OAUTH_CALLBACK = '/api/integrations/ringcentral/oauth/callback'

test('webhook echoes the Validation-Token handshake with 200', async ({ apiFetch }) => {
  const token = `e2e-handshake-${Date.now()}`
  const res = await apiFetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Validation-Token': token },
  })
  expect(res.status).toBe(200)
  // RingCentral confirms a subscription by matching the echoed header.
  expect(res.headers.get('validation-token')).toBe(token)
})

test('webhook rejects an event with no subscriptionId (400)', async ({ apiFetch }) => {
  const res = await apiFetch(WEBHOOK, { method: 'POST', body: JSON.stringify({ event: 'x' }) })
  expect(res.status).toBe(400)
})

test('webhook 404s for an unknown subscription', async ({ apiFetch }) => {
  const res = await apiFetch(WEBHOOK, {
    method: 'POST',
    headers: { 'verification-token': 'whatever' },
    body: JSON.stringify({ subscriptionId: `e2e-nonexistent-${Date.now()}` }),
  })
  expect(res.status).toBe(404)
})

test('oauth callback is mounted and validates input', async ({ apiFetch }) => {
  // No code/state. When the integration is disabled the callback fails closed
  // with 503; when enabled it rejects the missing code with 400. Either proves
  // the route is wired and inert-safe — it must never 200 without a real flow.
  const res = await apiFetch(OAUTH_CALLBACK)
  expect([400, 503]).toContain(res.status)
})
