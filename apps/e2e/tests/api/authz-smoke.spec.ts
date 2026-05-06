import { test, expect } from '../../fixtures'
import { hasAuthEnv } from '../../fixtures/cognito'

// Authenticated AVP smoke against staging. Untagged so the staging gate runs
// it. Skipped on local runs (E2E_TARGET !== 'remote') and skipped on remote
// runs that lack the auth env vars — local devs and ad-hoc remote runs without
// the staging admin credentials must still pass.
//
// Coverage:
//   1. /me/permissions answers for tenant_admin (proves AVP path is wired)
//   2. POST /users/invite is allowed by AVP for tenant_admin (proves a write
//      action evaluates to ALLOW end-to-end)
//
// Note: this gate proves AVP is answering correctly for the seeded admin.
// It does NOT prove that every tenant's persona policies uploaded cleanly
// during provisioning — that requires per-tenant sampling, out of scope.
const isRemote = process.env['E2E_TARGET'] === 'remote'
const skipReason = !isRemote
  ? 'authz-smoke runs only against remote staging'
  : !hasAuthEnv()
    ? 'authz-smoke requires E2E_COGNITO_TENANT_CLIENT_ID + E2E_STAGING_ADMIN_USERNAME + E2E_STAGING_ADMIN_PASSWORD'
    : !process.env['E2E_STAGING_TENANT_ID']
      ? 'authz-smoke requires E2E_STAGING_TENANT_ID'
      : null

test.describe('authenticated AVP smoke', () => {
  test.skip(!!skipReason, skipReason ?? '')

  test('GET /api/v1/me/permissions answers for tenant_admin', async ({ authedApiFetch }) => {
    const res = await authedApiFetch('/api/v1/me/permissions')
    expect(res.status, await res.text().catch(() => '')).toBe(200)
    const body = (await res.json()) as { roles: string[]; permissions: string[] }

    expect(Array.isArray(body.roles)).toBe(true)
    expect(body.roles).toContain('tenant_admin')

    expect(Array.isArray(body.permissions)).toBe(true)
    // tenant_admin must include the canonical write check — same assertion as
    // the local-only me-permissions.spec.ts. If this fails, AVP is either not
    // wired at all or the tenant_admin policies didn't upload.
    expect(body.permissions).toContain('quote:create')
    for (const p of body.permissions) {
      expect(p).toMatch(/^[a-z_]+:[a-z_]+$/)
    }
  })

  test('POST /api/v1/users/invite is allowed for tenant_admin', async ({ authedApiFetch }) => {
    // Idempotent across runs: the email is reserved for this test so a
    // second run yields 409 (CONFLICT) rather than unbounded-growing the
    // tenant_users table. See the plan for context.
    const res = await authedApiFetch('/api/v1/users/invite', {
      method: 'POST',
      body: JSON.stringify({ email: 'e2e-invite-target@pegasus-test.invalid' }),
    })

    // Reject 401 (token issue, not a Cedar issue) and 403 (AVP path skipped
    // or tenant_admin policies missing). Accept 200/201 (created) and 409
    // (already invited from a prior run — still proves AVP allowed the call).
    expect(
      [200, 201, 409],
      `expected 200/201/409 but got ${res.status}: ${await res.text().catch(() => '')}`,
    ).toContain(res.status)
  })
})
