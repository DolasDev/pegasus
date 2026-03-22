import { test, expect } from '@playwright/test'

// Browser tests require the web dev server to be running separately.
// Skipped by default in CI; run manually with the web server active.
test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')
test.skip(!process.env['WEB_URL'], 'WEB_URL not set — skipping browser tests (start web dev server first)')

test('landing page loads and displays the app', async ({ page }) => {
  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173'
  await page.goto(webUrl)
  // The page should load without error — check for a non-empty title
  const title = await page.title()
  expect(title.length).toBeGreaterThan(0)
  // Body should have content
  await expect(page.locator('body')).not.toBeEmpty()
})
