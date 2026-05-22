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

// Requires MSSQL + SKIP_AUTH; excluded from remote staging gate.
test.describe('longhaul @local-only', () => {
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

test('GET /api/v1/longhaul/trips with filters.id narrows the result to that trip', async ({
  apiFetch,
}) => {
  // Regression for Phase 3.1: the UI sends the whole TripQuery in `?filters=`.
  // Earlier the cloud handler read it flat and silently dropped filters.id,
  // returning all trips. Pick a real trip id from the unfiltered list, then
  // refetch with the realistic wire shape and assert we get exactly that row.
  const fetch = longhaulFetch(apiFetch)
  const listRes = await fetch('/api/v1/longhaul/trips')
  expect(listRes.status).toBe(200)
  const list = await listRes.json()
  expect(Array.isArray(list.data)).toBe(true)
  if (list.data.length === 0) {
    test.skip(true, 'Planning DB has no trips — cannot exercise filters.id')
    return
  }
  const tripId = String(list.data[0].id)

  const wireQuery = JSON.stringify({
    searchTerm: '',
    filters: { id: tripId },
    sortBy: { value: 'planned_first_day', order: 'desc' },
  })
  const filteredRes = await fetch(
    `/api/v1/longhaul/trips?filters=${encodeURIComponent(wireQuery)}`,
  )
  expect(filteredRes.status).toBe(200)
  const filtered = await filteredRes.json()
  expect(Array.isArray(filtered.data)).toBe(true)
  expect(filtered.data.length).toBe(1)
  expect(String(filtered.data[0].id)).toBe(tripId)
})

test('GET /api/v1/longhaul/trips/:id returns the trip with notes/activities/shipments arrays', async ({
  apiFetch,
}) => {
  // Regression for Phase 3.1: the cloud handler used to read only the first
  // statement's recordset from a multi-statement batch and silently dropped
  // the child collections. Assert each is at least an array; the QA suite
  // covers populated-content assertions against the seeded planning DB.
  const fetch = longhaulFetch(apiFetch)
  const listRes = await fetch('/api/v1/longhaul/trips')
  expect(listRes.status).toBe(200)
  const list = await listRes.json()
  if (list.data.length === 0) {
    test.skip(true, 'Planning DB has no trips — cannot exercise /trips/:id')
    return
  }
  const tripId = list.data[0].id
  const detailRes = await fetch(`/api/v1/longhaul/trips/${tripId}`)
  expect(detailRes.status).toBe(200)
  const detail = await detailRes.json()
  expect(detail.data).toBeDefined()
  expect(detail.data.id).toBe(tripId)
  expect(Array.isArray(detail.data.notes)).toBe(true)
  expect(Array.isArray(detail.data.activities)).toBe(true)
  expect(Array.isArray(detail.data.shipments)).toBe(true)
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
})
