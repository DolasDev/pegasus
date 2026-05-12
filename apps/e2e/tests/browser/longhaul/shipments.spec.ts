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
  })

  test('loads the Shipments module @smoke', async ({ page }) => {
    const sp = new ShipmentsPage(page)
    await expect(sp.heading).toBeVisible()
    await expect(sp.searchInput).toBeVisible()
  })

  test('the known-good DB yields shipment rows under the default filter', async ({ page }) => {
    // The ShipmentModule route now fetches on mount (default filter:
    // Is_Trip_Planning=true, load_date ±30d, assigned=No). An empty table here
    // means the QA planning DB has no matching shipments or the on-prem query is
    // timing out — a real finding, so this fails rather than skips.
    const sp = new ShipmentsPage(page)
    await expect.poll(() => sp.rowCount(), { timeout: 25_000 }).toBeGreaterThan(0)
  })

  test('the FilterTabs panel expands and collapses', async ({ page }) => {
    const sp = new ShipmentsPage(page)
    await expect(sp.filtersBody).toHaveAttribute('data-open', 'false')
    // The 15 filter rows are always in the DOM (collapsed via CSS) — assert the
    // "assigned" one exists; the default filter (Assigned=No) sets a count > 0.
    await expect(sp.filterRow('assigned')).toBeAttached()
    await sp.toggleFilters.click()
    await expect(sp.filtersBody).toHaveAttribute('data-open', 'true')
    await sp.toggleFilters.click()
    await expect(sp.filtersBody).toHaveAttribute('data-open', 'false')
  })

  test('FilterTabs: changing the Assigned filter narrows / widens the list', async () => {
    test.fixme(true, 'walkthrough: drive the react-select "assigned" control + assert row count')
  })

  test('saving and re-applying a personal filter @qa-mutating', async () => {
    test.fixme(true, 'walkthrough: confirm the Save-filter modal + the saved-filters list')
  })

  test('clicking a shipment row opens the ShipmentDetail pane', async () => {
    test.fixme(
      true,
      'walkthrough: ShipmentsTable rows are not wired to selectShipment yet — confirm',
    )
  })
})
