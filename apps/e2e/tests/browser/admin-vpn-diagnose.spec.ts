import { test, expect } from '@playwright/test'

// ---------------------------------------------------------------------------
// Admin-web VPN Diagnose button — Playwright browser spec.
//
// This test mocks the diagnose API via `page.route` and asserts the rendered
// report markup matches expectations for both pass and fail summaries.
//
// TODO: This spec is currently skipped because admin-web's tenant detail page
// lives behind the Cognito-auth-guarded `_auth` layout, and the e2e suite
// does not yet have a browser-spec login helper. `landing.spec.ts` is the
// only existing browser spec and only covers the unauthenticated landing
// page. Re-enable this spec when authenticated browser-spec scaffolding
// (login helper or storage-state fixture) lands. See plan
// `plans/in-progress/admin-web-vpn-diagnose-button.md` step 5.
// ---------------------------------------------------------------------------

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')
test.skip(
  !process.env['WEB_URL'],
  'WEB_URL not set — skipping browser tests (start admin-web dev server first)',
)
test.skip(true, 'TODO: needs authenticated browser-spec scaffolding (see file header)')

const TENANT_ID = process.env['TEST_TENANT_ID'] ?? 'e2e00000-0000-0000-0000-000000000001'

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

async function loadTenantDetail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  fixture: typeof PASS_FIXTURE | typeof FAIL_FIXTURE,
) {
  await page.route(`**/api/admin/tenants/*/vpn/diagnose`, (route: { fulfill: (r: object) => Promise<void> }) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: fixture }),
    }),
  )
  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5174'
  await page.goto(`${webUrl}/tenants/${TENANT_ID}`)
  await page.getByTestId('vpn-diagnose-run').click()
}

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
