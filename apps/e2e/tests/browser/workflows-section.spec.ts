import { test, expect } from '../../fixtures'
import { AppShellPage } from './pages/AppShellPage'

// ---------------------------------------------------------------------------
// Workflows section smoke — /workflows (plans/*/tenant-web-workflows-section.md).
//
// The admin reaches the durable Workflows list from the main nav, and the page
// renders through the real SPA → API path (GET /api/v1/workflow-executions):
// either instance rows or the "No open Workflows" empty state, never the error
// banner. Count-agnostic: the local seed has no durable Workflow instance (one
// needs Temporal), so the empty state is the expected local outcome.
//
// Tagged @local-only: needs the seeded local DB + SKIP_AUTH API + the e2e-mode
// tenant-web build (see shell-nav.spec.ts for the auth seam). Skips without
// WEB_URL so a plain `npm run e2e` (API-only) stays green.
// ---------------------------------------------------------------------------

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')
test.skip(
  !process.env['WEB_URL'],
  'WEB_URL not set — skipping browser tests (serve the e2e-mode tenant-web build first)',
)

const WEB_URL = process.env['WEB_URL'] ?? 'http://localhost:4173'

test.describe('workflows section @local-only', () => {
  test('the Workflows nav entry opens the instance list', async ({ page }) => {
    const shell = new AppShellPage(page, WEB_URL)
    await shell.gotoDashboard()

    await shell.navLink('Workflows').click()
    await expect(page).toHaveURL(/\/workflows$/)
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible()

    // The list request resolved: rows or the empty state, and no error banner.
    const rows = page.locator('a[href^="/workflows/"]')
    const empty = page.getByText('No open Workflows')
    await expect(rows.first().or(empty)).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)

    // The Open/All toggle re-queries without breaking the page.
    await page.getByRole('button', { name: 'All', exact: true }).click()
    await expect(rows.first().or(page.getByText('No Workflows', { exact: true }))).toBeVisible()
  })
})
