import { test, expect, type Page, type Route } from '@playwright/test'
import { seedAdminAuth } from '../../fixtures/auth'

// ---------------------------------------------------------------------------
// Admin-web VPN Diagnose button — Playwright browser spec.
//
// Tagged `@local-only`: every backend call is mocked via `page.route` and the
// Cognito session is faked via `seedAdminAuth`, so this spec is meaningless
// against a real staging API. The remote E2E gate excludes it via
// `grepInvert: /@local-only/` (see apps/e2e/playwright.config.ts).
// ---------------------------------------------------------------------------

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')
// ADMIN_WEB_URL (not WEB_URL): this spec drives ADMIN-web. PR CI sets WEB_URL
// to a served tenant-web build for the core-flow browser specs — keying this
// spec on WEB_URL would point it at the wrong app there.
test.skip(
  !process.env['ADMIN_WEB_URL'],
  'ADMIN_WEB_URL not set — skipping browser tests (start admin-web dev server first)',
)

const TENANT_ID = process.env['TEST_TENANT_ID'] ?? 'e2e00000-0000-0000-0000-000000000001'

const TENANT_FIXTURE = {
  id: TENANT_ID,
  name: 'E2E Tenant',
  slug: 'e2e-tenant',
  status: 'ACTIVE' as const,
  plan: 'GROWTH' as const,
  contactName: 'E2E Operator',
  contactEmail: 'ops@e2e.example',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
}

const VPN_STATUS_FIXTURE = {
  id: 'peer-e2e',
  tenantId: TENANT_ID,
  assignedIp: '10.200.7.1',
  publicKey: 'AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555FFFF6666GGGG7777=',
  status: 'ACTIVE' as const,
  lastHandshakeAt: '2026-05-05T11:59:00.000Z',
  handshakeAgeSec: 42,
  rxBytes: '1048576',
  txBytes: '524288',
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-05-05T12:00:00.000Z',
}

const PASS_FIXTURE = {
  tenantId: TENANT_ID,
  summary: 'pass' as const,
  firstFailure: null,
  checks: Array.from({ length: 10 }, (_, i) => ({
    id: `check-${i + 1}`,
    label: `Check ${i + 1}`,
    status: 'pass' as const,
    detail: `Check ${i + 1} passed`,
    elapsedMs: 12 + i,
  })),
}

const FAIL_FIXTURE = {
  tenantId: TENANT_ID,
  summary: 'fail' as const,
  firstFailure: 'hub-wg-handshake',
  checks: [
    {
      id: 'cloud-egress',
      label: 'Cloud egress',
      status: 'pass' as const,
      detail: 'Lambda VPC has NAT route',
      elapsedMs: 18,
    },
    {
      id: 'hub-wg-handshake',
      label: 'Hub WireGuard handshake',
      status: 'fail' as const,
      detail: 'No recent handshake from tenant peer',
      evidence: { lastHandshakeAt: null, peerKey: 'AAAA…' },
      elapsedMs: 6042,
    },
    {
      id: 'tenant-overlay-ping',
      label: 'Tenant overlay ping',
      status: 'skip' as const,
      detail: 'Skipped — hub handshake failed',
      elapsedMs: 0,
    },
  ],
}

function jsonRoute(payload: unknown) {
  return (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    })
}

async function loadTenantDetail(
  page: Page,
  diagnoseFixture: typeof PASS_FIXTURE | typeof FAIL_FIXTURE,
) {
  await page.route(`**/api/admin/tenants/${TENANT_ID}`, jsonRoute({ data: TENANT_FIXTURE }))
  await page.route(
    `**/api/admin/tenants/${TENANT_ID}/vpn/status`,
    jsonRoute({ data: VPN_STATUS_FIXTURE }),
  )
  await page.route(
    `**/api/admin/tenants/${TENANT_ID}/vpn/diagnose`,
    jsonRoute({ data: diagnoseFixture }),
  )
  const webUrl = process.env['ADMIN_WEB_URL'] ?? 'http://localhost:5174'
  await page.goto(`${webUrl}/tenants/${TENANT_ID}`)
  await page.getByTestId('vpn-diagnose-run').click()
}

test.describe('@local-only admin-web VPN diagnose', () => {
  test.beforeEach(async ({ page }) => {
    await seedAdminAuth(page)
  })

  test('diagnose pass renders green summary and 10 check rows', async ({ page }) => {
    await loadTenantDetail(page, PASS_FIXTURE)
    await expect(page.getByTestId('vpn-diagnose-summary')).toHaveText(/pass/i)
    await expect(page.getByTestId('vpn-diagnose-first-failure')).toHaveCount(0)
    for (let i = 1; i <= 10; i += 1) {
      await expect(page.getByTestId(`vpn-diagnose-check-check-${i}`)).toBeVisible()
    }
    await expect(page.getByTestId('vpn-diagnose-generated-at')).toBeVisible()
  })

  test('diagnose fail renders first-failure callout and reveals evidence', async ({ page }) => {
    await loadTenantDetail(page, FAIL_FIXTURE)
    await expect(page.getByTestId('vpn-diagnose-summary')).toHaveText(/fail/i)
    await expect(page.getByTestId('vpn-diagnose-first-failure')).toContainText('hub-wg-handshake')
    const failingRow = page.getByTestId('vpn-diagnose-check-hub-wg-handshake')
    await expect(failingRow).toHaveAttribute('data-status', 'fail')
    await expect(failingRow).toHaveClass(/border-destructive/)
    await failingRow.getByRole('button', { name: 'Show details' }).click()
    await expect(failingRow.locator('pre')).toContainText('lastHandshakeAt')
  })
})
