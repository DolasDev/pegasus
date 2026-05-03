import { test, expect } from '../../fixtures'

// Local-only: needs the SKIP_AUTH webServer to synthesise a tenant_admin
// principal. The remote staging API rejects unauthenticated requests.
test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')

test('@local-only GET /api/v1/me/permissions returns role-aware shape', async ({ apiFetch }) => {
  const res = await apiFetch('/api/v1/me/permissions')
  expect(res.status).toBe(200)
  const body = (await res.json()) as { roles: string[]; permissions: string[] }

  // SKIP_AUTH synthesises tenant_admin — see apps/api/src/app.ts.
  expect(Array.isArray(body.roles)).toBe(true)
  expect(body.roles).toContain('tenant_admin')

  expect(Array.isArray(body.permissions)).toBe(true)
  // tenant_admin must include the canonical write check from the plan.
  expect(body.permissions).toContain('quote:create')
  // Sanity-check the public contract — every entry is a `resource:verb` pair.
  for (const p of body.permissions) {
    expect(p).toMatch(/^[a-z_]+:[a-z_]+$/)
  }
})
