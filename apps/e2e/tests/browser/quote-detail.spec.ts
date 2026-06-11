import { test, expect } from '../../fixtures'
import { QuoteDetailPage } from './pages/QuoteDetailPage'

// ---------------------------------------------------------------------------
// Core flow 3 — create a quote (for a customer's move), open its detail page,
// and assert the line-item math renders.
//
// Creation goes through the API (customer → move → quote with line items) via
// the SKIP_AUTH `apiFetch` fixture because tenant-web has no quote-builder UI
// yet; the browser half asserts /quotes/:id renders the Summary total and the
// client-side computed per-line totals (quantity × unit price). Requires the
// e2e auth-seam tenant-web build — see shell-nav.spec.ts header.
//
// Tagged @local-only: needs the seeded local DB + SKIP_AUTH API + seam build.
// No variant pinning needed — /quotes does not randomize variants.
// ---------------------------------------------------------------------------

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')
test.skip(
  !process.env['WEB_URL'],
  'WEB_URL not set — skipping browser tests (serve the e2e-mode tenant-web build first)',
)

const WEB_URL = process.env['WEB_URL'] ?? 'http://localhost:4173'

test.describe('quote detail @local-only', () => {
  test('quote created from a customer move renders line-item math', async ({ page, apiFetch }) => {
    // Customer the move/quote belongs to (mirrors the lead → quote flow).
    const customerRes = await apiFetch('/api/v1/customers', {
      method: 'POST',
      body: JSON.stringify({
        userId: 'e2e-user',
        firstName: 'Quincy',
        lastName: `Quote${Date.now()}`,
        email: `quote-e2e-${Date.now()}@example.com`,
        phone: '555-0142',
        primaryContact: {
          firstName: 'Quincy',
          lastName: 'Quote',
          email: `quote-contact-${Date.now()}@example.com`,
          phone: '555-0142',
          isPrimary: true,
        },
      }),
    })
    expect(customerRes.status).toBe(201)

    const moveRes = await apiFetch('/api/v1/moves', {
      method: 'POST',
      body: JSON.stringify({
        userId: 'e2e-user',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        origin: {
          line1: '100 Origin St',
          city: 'Springfield',
          state: 'IL',
          postalCode: '62701',
          country: 'US',
        },
        destination: {
          line1: '200 Destination Ave',
          city: 'Shelbyville',
          state: 'IL',
          postalCode: '62565',
          country: 'US',
        },
      }),
    })
    expect(moveRes.status).toBe(201)
    const moveId: string = (await moveRes.json()).data.id

    // Two line items with non-trivial quantities so a rendered total can only
    // be right if the page actually multiplies (not echoes the unit price).
    const items = [
      { description: 'Packing crew', quantity: 3, unitPrice: 125.5 },
      { description: 'Mileage surcharge', quantity: 2, unitPrice: 80.25 },
    ]
    const total = 3 * 125.5 + 2 * 80.25 // 537.00

    const quoteRes = await apiFetch('/api/v1/quotes', {
      method: 'POST',
      body: JSON.stringify({
        moveId,
        priceAmount: total,
        priceCurrency: 'USD',
        validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
        lineItems: items,
      }),
    })
    expect(quoteRes.status).toBe(201)
    const quoteId: string = (await quoteRes.json()).data.id

    const detail = new QuoteDetailPage(page, WEB_URL)
    await detail.goto(quoteId)

    // Summary total.
    await expect(page.getByText(QuoteDetailPage.money('USD', total))).toBeVisible()

    // Per-line computed totals: quantity × unit price, formatted client-side.
    for (const item of items) {
      const row = detail.lineItemRow(item.description)
      await expect(row).toContainText(String(item.quantity))
      await expect(row).toContainText(QuoteDetailPage.money('USD', item.unitPrice))
      await expect(row).toContainText(QuoteDetailPage.money('USD', item.quantity * item.unitPrice))
    }
  })
})
