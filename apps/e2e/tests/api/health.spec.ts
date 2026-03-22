import { test, expect } from '../../fixtures'

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')

test('GET /health returns ok', async ({ apiFetch }) => {
  const res = await apiFetch('/health')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.status).toBe('ok')
  expect(typeof body.timestamp).toBe('string')
})

test('GET /health?deep=true returns ok with db status', async ({ apiFetch }) => {
  const res = await apiFetch('/health?deep=true')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.status).toBe('ok')
  expect(body.db).toBe('ok')
  expect(typeof body.timestamp).toBe('string')
})
