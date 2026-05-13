import { test, expect, gateOnOnpremHealth } from './_shared'
import { ShipmentsPage } from './pages/ShipmentsPage'

// ---------------------------------------------------------------------------
// /driver-planning/shipments — the legacy Shipments table (ShipmentModule).
//
// Note: the standalone /shipments route renders the plain <ShipmentsTable>, not
// the search-dashboard variant — so its column headers aren't sortable and there
// is no "Shipments (n)" count. The sortable/card UI lives in the /planning left
// pane (SearchDashboard). FilterTabs is shared between both.
// ---------------------------------------------------------------------------

test.describe('Shipments tab', () => {
  test.beforeEach(async ({ page, qaWebUrl, qaApiFetch }) => {
    const layout = await gateOnOnpremHealth(page, qaWebUrl, qaApiFetch)
    await layout.openTab('Shipments')
    // Best-effort module-mount wait with one reload-retry. The on-prem
    // `/users/me` lookup AppGuard gates on can stretch past 15 s; one reload
    // dodges it before any test asserts. Always best-effort — a `test.fixme`'d
    // test below shouldn't hard-fail in beforeEach on a slow on-prem moment.
    const sp = new ShipmentsPage(page)
    try {
      await sp.searchInput.waitFor({ state: 'visible', timeout: 15_000 })
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await sp.searchInput.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
    }
  })

  test('loads the Shipments module @smoke', async ({ page }) => {
    const sp = new ShipmentsPage(page)
    await expect(sp.heading).toBeVisible({ timeout: 30_000 })
    await expect(sp.searchInput).toBeVisible({ timeout: 30_000 })
  })

  test('the known-good DB yields shipment rows under the default filter', async ({ page }) => {
    // The ShipmentModule route now fetches on mount (default filter:
    // Is_Trip_Planning=true, load_date ±30d, assigned=No). An empty table here
    // means the QA planning DB has no matching shipments or the on-prem query is
    // timing out — a real finding, so this fails rather than skips. On congested
    // runs the AppGuard bootstrap can leave the module unmounted past the poll
    // timeout — one reload-retry before treating empty as the real finding.
    const sp = new ShipmentsPage(page)
    try {
      await expect.poll(() => sp.rowCount(), { timeout: 20_000 }).toBeGreaterThan(0)
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await sp.searchInput.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
      await expect.poll(() => sp.rowCount(), { timeout: 40_000 }).toBeGreaterThan(0)
    }
  })

  test('the FilterTabs panel expands and collapses', async ({ page }) => {
    const sp = new ShipmentsPage(page)
    await expect(sp.filtersBody).toHaveAttribute('data-open', 'false', { timeout: 30_000 })
    // The 15 filter rows are always in the DOM (collapsed via CSS) — assert the
    // "assigned" one exists.
    await expect(sp.filterRow('assigned')).toBeAttached()
    await sp.toggleFilters.click()
    await expect(sp.filtersBody).toHaveAttribute('data-open', 'true')
    await sp.toggleFilters.click()
    await expect(sp.filtersBody).toHaveAttribute('data-open', 'false')
  })

  test('the Assigned react-select takes a selection and re-queries', async ({ page }) => {
    const sp = new ShipmentsPage(page)
    // Reload-retry on the initial-load poll (see shipments:32 / trips:23).
    // The post-filter-change poll below stays as a hard assertion — that one
    // is "did the re-fetch return", not "did the module ever mount".
    try {
      await expect.poll(() => sp.rowCount(), { timeout: 20_000 }).toBeGreaterThan(0)
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await sp.searchInput.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
      await expect.poll(() => sp.rowCount(), { timeout: 40_000 }).toBeGreaterThan(0)
    }

    await sp.toggleFilters.click()
    await expect(sp.filtersBody).toHaveAttribute('data-open', 'true')
    // react-select hides already-selected options, so pick whichever of Yes / No
    // isn't currently a chip. (The QA user may carry a saved default filter, so
    // don't assume the starting selection.)
    const before = await sp.selectFilterChips('assigned')
    const want = before.includes('Yes') ? 'No' : 'Yes'
    await sp.addSelectFilterOption('assigned', want)
    expect(await sp.selectFilterChips('assigned')).toContain(want)

    // The list re-fetches (debounced ~1s). It stays populated: any combination
    // of assigned states in the ±30d window still matches shipments (if an
    // over-broad window ever 400'd → [] here that's a real finding about the QA
    // snapshot, not a test problem).
    await expect.poll(() => sp.rowCount(), { timeout: 40_000 }).toBeGreaterThan(0)
  })

  test('saving and re-applying a personal filter @qa-mutating', async () => {
    test.fixme(true, 'walkthrough: confirm the Save-filter modal + the saved-filters list')
  })

  test('clicking a shipment row opens the ShipmentDetail pane', async ({ page }) => {
    const sp = new ShipmentsPage(page)
    // Reload-retry on the initial-load poll (see shipments:32 / trips:23).
    try {
      await expect.poll(() => sp.rowCount(), { timeout: 20_000 }).toBeGreaterThan(0)
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await sp.searchInput.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
      await expect.poll(() => sp.rowCount(), { timeout: 40_000 }).toBeGreaterThan(0)
    }
    await expect(sp.shipmentDetailPane).toHaveAttribute('data-open', 'false')
    // selectShipment(row) → API.fetchShipments({searchTerm: order_num}) →
    // selectedShipment → the pane opens.
    await sp.rows.first().click()
    await expect(sp.shipmentDetailPane).toHaveAttribute('data-open', 'true', { timeout: 25_000 })
    await expect(sp.shipmentDetailField('Shipper Name')).toBeVisible()
  })
})
