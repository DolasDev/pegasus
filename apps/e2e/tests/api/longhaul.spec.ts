import { test, expect } from '../../fixtures'

// These tests require a live MSSQL connection and SKIP_AUTH=true on the server.
// They are skipped when MSSQL_HOST is not set in the environment.
const mssqlAvailable = !!process.env['MSSQL_HOST']
const windowsUser = process.env['TEST_WINDOWS_USER'] ?? 'testuser'

test.skip(!mssqlAvailable, 'MSSQL not configured — skipping longhaul E2E tests')

// Helper: apiFetch with X-Windows-User header injected
function longhaulFetch(apiFetch: (path: string, init?: RequestInit) => Promise<Response>) {
  return (path: string, init: RequestInit = {}) =>
    apiFetch(path, {
      ...init,
      headers: {
        'X-Windows-User': windowsUser,
        ...(init.headers as Record<string, string> | undefined),
      },
    })
}

test('GET /api/v1/longhaul/users/me returns the authenticated user', async ({ apiFetch }) => {
  const fetch = longhaulFetch(apiFetch)
  const res = await fetch('/api/v1/longhaul/users/me')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.data).not.toBeNull()
})

test('GET /api/v1/longhaul/shipments returns shipments list', async ({ apiFetch }) => {
  const fetch = longhaulFetch(apiFetch)
  const res = await fetch('/api/v1/longhaul/shipments')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body.data)).toBe(true)
  expect(typeof body.meta.count).toBe('number')
})

test('GET /api/v1/longhaul/trips returns trips list', async ({ apiFetch }) => {
  const fetch = longhaulFetch(apiFetch)
  const res = await fetch('/api/v1/longhaul/trips')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body.data)).toBe(true)
  expect(typeof body.meta.count).toBe('number')
})

test('GET /api/v1/longhaul/trips with filters returns filtered results', async ({ apiFetch }) => {
  const fetch = longhaulFetch(apiFetch)
  const filters = JSON.stringify({ TripStatus_id: 1 })
  const res = await fetch(`/api/v1/longhaul/trips?filters=${encodeURIComponent(filters)}`)
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body.data)).toBe(true)
})

test('GET /api/v1/longhaul/trips/:id returns 404 for non-existent trip', async ({ apiFetch }) => {
  const fetch = longhaulFetch(apiFetch)
  const res = await fetch('/api/v1/longhaul/trips/999999999')
  expect(res.status).toBe(404)
})

test('GET /api/v1/longhaul/trip-statuses returns statuses', async ({ apiFetch }) => {
  const fetch = longhaulFetch(apiFetch)
  const res = await fetch('/api/v1/longhaul/trip-statuses')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body.data)).toBe(true)
})

test('GET /api/v1/longhaul/drivers returns drivers list', async ({ apiFetch }) => {
  const fetch = longhaulFetch(apiFetch)
  const res = await fetch('/api/v1/longhaul/drivers')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body.data)).toBe(true)
})

test('GET /api/v1/longhaul/filter-options returns filter options', async ({ apiFetch }) => {
  const fetch = longhaulFetch(apiFetch)
  const res = await fetch('/api/v1/longhaul/filter-options')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.data).toBeDefined()
})

test('GET /api/v1/longhaul/shipment-filters returns saved filters for user', async ({
  apiFetch,
}) => {
  const fetch = longhaulFetch(apiFetch)
  const res = await fetch('/api/v1/longhaul/shipment-filters')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body.data)).toBe(true)
})

test('GET /api/v1/longhaul/version returns version info', async ({ apiFetch }) => {
  const fetch = longhaulFetch(apiFetch)
  const res = await fetch('/api/v1/longhaul/version')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.data).toBeDefined()
})

test('POST /api/v1/longhaul/trips without shipments returns 403', async ({ apiFetch }) => {
  const fetch = longhaulFetch(apiFetch)
  const res = await fetch('/api/v1/longhaul/trips', {
    method: 'POST',
    body: JSON.stringify({ trip_title: 'E2E Test Trip', shipments: [] }),
  })
  expect(res.status).toBe(403)
})

test('PATCH /api/v1/longhaul/trips/:id/status returns 404 for non-existent trip', async ({
  apiFetch,
}) => {
  const fetch = longhaulFetch(apiFetch)
  const res = await fetch('/api/v1/longhaul/trips/999999999/status', {
    method: 'PATCH',
    body: JSON.stringify({ statusId: 2 }),
  })
  expect(res.status).toBe(404)
})

test('longhaul routes return 403 when X-Windows-User is missing (SKIP_AUTH mode)', async ({
  apiFetch,
}) => {
  // Call without the X-Windows-User header to confirm auth is enforced
  const res = await apiFetch('/api/v1/longhaul/users/me')
  // In SKIP_AUTH mode: 403. In MSSQL_UNAVAILABLE: 503. Either means auth is enforced.
  expect([403, 503]).toContain(res.status)
})
