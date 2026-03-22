import { test, expect } from '../../fixtures'

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')

const origin = {
  line1: '100 Origin St',
  city: 'Springfield',
  state: 'IL',
  postalCode: '62701',
  country: 'US',
}

const destination = {
  line1: '200 Destination Ave',
  city: 'Shelbyville',
  state: 'IL',
  postalCode: '62565',
  country: 'US',
}

test('POST /api/v1/moves creates a move', async ({ apiFetch }) => {
  const res = await apiFetch('/api/v1/moves', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'e2e-user',
      scheduledDate: new Date(Date.now() + 86400000).toISOString(),
      origin,
      destination,
    }),
  })
  expect(res.status).toBe(201)
  const body = await res.json()
  expect(body.data.status).toBe('PENDING')
  expect(typeof body.data.id).toBe('string')
})

test('GET /api/v1/moves returns a list', async ({ apiFetch }) => {
  const res = await apiFetch('/api/v1/moves')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body.data)).toBe(true)
  expect(typeof body.meta.count).toBe('number')
})
