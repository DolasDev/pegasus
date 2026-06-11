import { test, expect } from '../../fixtures'
import { AppShellPage, ADMIN_NAV_LABELS } from './pages/AppShellPage'

// ---------------------------------------------------------------------------
// Core flow 1 — the authenticated login shell loads and the nav renders.
//
// AUTH SEAM (audit-e2e-strategy 2.2, option (a) — chosen after spike):
// tenant-web must be BUILT with `vite build --mode e2e`, which compiles in a
// synthetic tenant_admin session (apps/tenant-web/src/auth/session.ts) so the
// route auth guards pass without Cognito. The API behind WEB_URL must run with
// SKIP_AUTH=true (it ignores the synthetic bearer token). The seam keys on
// `import.meta.env.MODE` because Vite statically replaces it — a production
// build (var-free, mode "production") dead-code-eliminates the entire seam;
// unset VITE_* env vars are NOT eliminated, which is why option (a)'s original
// `VITE_E2E_SKIP_AUTH` shape was discarded. Option (b) (storageState
// injection) was rejected: a forged session would still fail signature
// validation paths if any were added later, and the build-time seam is less
// machinery. See apps/e2e/README.md ("Browser specs") for the run recipe.
//
// Tagged @local-only: needs the seeded local DB + SKIP_AUTH API + seam build.
// Skips without WEB_URL so a plain `npm run e2e` (API-only) stays green.
// No variant pinning needed — the shell does not randomize variants.
// ---------------------------------------------------------------------------

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')
test.skip(
  !process.env['WEB_URL'],
  'WEB_URL not set — skipping browser tests (serve the e2e-mode tenant-web build first)',
)

const WEB_URL = process.env['WEB_URL'] ?? 'http://localhost:4173'

test.describe('app shell @local-only', () => {
  test('login shell loads and the admin nav renders', async ({ page }) => {
    const shell = new AppShellPage(page, WEB_URL)
    await shell.gotoDashboard()

    // Nav items render only after GET /me/permissions resolves, so this
    // asserts the full SPA → API path, not just static markup.
    for (const label of ADMIN_NAV_LABELS) {
      await expect(shell.navLink(label)).toBeVisible()
    }

    // Header shows the synthetic seam session's tenant + user identity.
    await expect(shell.header).toContainText('E2E Test Tenant')
    await expect(shell.header).toContainText('e2e-admin@example.com')
  })
})
