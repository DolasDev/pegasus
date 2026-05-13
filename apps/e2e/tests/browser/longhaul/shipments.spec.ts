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
    // Wait for AppGuard to clear "Loading…" and the module to mount before any
    // assertion runs — the on-prem `/users/me` lookup AppGuard gates on can be
    // slow, and the FilterTabs `data-target`s only exist once it has.
    await expect(new ShipmentsPage(page).searchInput).toBeVisible({ timeout: 30_000 })
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
    await expect.poll(() => sp.rowCount(), { timeout: 40_000 }).toBeGreaterThan(0)
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

  test('FilterTabs: the Assigned react-select takes a selection and re-queries', async ({
    page,
  }) => {
    const sp = new ShipmentsPage(page)
    // Default filter is Assigned=["No"] → unassigned shipments only.
    await expect.poll(() => sp.rowCount(), { timeout: 40_000 }).toBeGreaterThan(0)
    const before = await sp.rowOrderNums()
    expect(before.length).toBeGreaterThan(0)

    await sp.toggleFilters.click()
    await expect(sp.filtersBody).toHaveAttribute('data-open', 'true')
    // Add "Yes" → selection is ["No","Yes"]. The on-prem only applies the
    // `assigned` filter when exactly one value is selected, so two values drops
    // it → "all shipments in the ±30d window" (a superset of unassigned-only).
    await sp.addSelectFilterOption('assigned', 'Yes')
    expect(await sp.selectFilterChips('assigned')).toEqual(expect.arrayContaining(['No', 'Yes']))

    // The list re-fetches (debounced ~1s). Expect it to settle to a superset of
    // the unassigned-only list (the table never empties: dropping `assigned`
    // only widens, and an over-broad window would 400 → []; if that ever bites
    // here it's a real finding about the QA snapshot, not a test problem).
    await expect
      .poll(
        async () => {
          const after = await sp.rowOrderNums()
          return after.length >= before.length && before.every((n) => after.includes(n))
        },
        { timeout: 40_000 },
      )
      .toBe(true)
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
