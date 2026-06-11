import { test, expect } from '../../fixtures'
import { CustomersPage } from './pages/CustomersPage'

// ---------------------------------------------------------------------------
// Core flow 2 — create a customer, see it in the /customers list.
//
// Creation goes through POST /api/v1/customers (the SKIP_AUTH `apiFetch`
// fixture) because tenant-web has no create-customer UI yet; the browser half
// asserts the list page fetches and renders the new record. Requires the e2e
// auth-seam tenant-web build — see shell-nav.spec.ts header for the contract.
//
// Tagged @local-only: needs the seeded local DB + SKIP_AUTH API + seam build.
// No variant pinning needed — /customers does not randomize variants.
// ---------------------------------------------------------------------------

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')
test.skip(
  !process.env['WEB_URL'],
  'WEB_URL not set — skipping browser tests (serve the e2e-mode tenant-web build first)',
)

const WEB_URL = process.env['WEB_URL'] ?? 'http://localhost:4173'

test.describe('customers list @local-only', () => {
  test('created customer appears in the customers list', async ({ page, apiFetch }) => {
    // Unique last name so the client-side filter isolates exactly this record
    // even against a dirty local DB.
    const lastName = `Browser${Date.now()}`
    const email = `browser-e2e-${Date.now()}@example.com`

    const res = await apiFetch('/api/v1/customers', {
      method: 'POST',
      body: JSON.stringify({
        userId: 'e2e-user',
        firstName: 'Casey',
        lastName,
        email,
        phone: '555-0199',
        primaryContact: {
          firstName: 'Casey',
          lastName,
          email: `browser-contact-${Date.now()}@example.com`,
          phone: '555-0199',
          isPrimary: true,
        },
      }),
    })
    expect(res.status).toBe(201)

    const customers = new CustomersPage(page, WEB_URL)
    await customers.goto()
    await customers.filterByLastName(lastName)

    const row = customers.rowByText(lastName)
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Casey')
    await expect(row).toContainText(email)
  })
})
