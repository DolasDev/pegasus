import { test, expect } from '../../fixtures'

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')

test('POST /api/v1/customers creates a customer', async ({ apiFetch }) => {
  const res = await apiFetch('/api/v1/customers', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'e2e-user',
      firstName: 'Alice',
      lastName: 'E2E',
      email: `alice-e2e-${Date.now()}@example.com`,
      phone: '555-0100',
      primaryContact: {
        firstName: 'Alice',
        lastName: 'E2E',
        email: `alice-contact-${Date.now()}@example.com`,
        phone: '555-0100',
        isPrimary: true,
      },
    }),
  })
  expect(res.status).toBe(201)
  const body = await res.json()
  expect(body.data.firstName).toBe('Alice')
  expect(body.data.lastName).toBe('E2E')
  expect(typeof body.data.id).toBe('string')
})

test('GET /api/v1/customers returns a list', async ({ apiFetch }) => {
  const res = await apiFetch('/api/v1/customers')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body.data)).toBe(true)
  expect(typeof body.meta.count).toBe('number')
})
