import { test, expect, gateOnOnpremHealth } from './_shared'
import { ShipmentsPage } from './pages/ShipmentsPage'

// ---------------------------------------------------------------------------
// /driver-planning/shipments — the legacy Shipments search dashboard.
//
// Confident smoke assertions run normally. Interactions whose selectors depend
// on the ported `FilterTabs` / `ShipmentsTable` / `ShipmentCard` DOM are
// `test.fixme`'d until the Phase A exploratory pass confirms them (and, ideally,
// adds data-testids to those components). See plans/.../i-ve-placed-... and QA.md.
// ---------------------------------------------------------------------------

test.describe('Shipments tab', () => {
  test.beforeEach(async ({ page, qaWebUrl, qaApiFetch }) => {
    const layout = await gateOnOnpremHealth(page, qaWebUrl, qaApiFetch)
    await layout.openTab('Shipments')
  })

  test('loads the Shipments module @smoke', async ({ page }) => {
    const sp = new ShipmentsPage(page)
    await expect(sp.heading).toBeVisible()
  })

  test('the known-good DB yields shipment rows under the default filter', async ({ page }) => {
    // Fails (rather than skips) when empty — the QA planning DB not being loaded
    // with shipment data, or the on-prem /shipments query timing out (504), is a
    // real finding. Default filter: Is_Trip_Planning=true, load_date ±30d, assigned=No.
    const sp = new ShipmentsPage(page)
    await expect.poll(() => sp.rowCount(), { timeout: 20_000 }).toBeGreaterThan(0)
  })

  test('shows a shipment count in the lane title', async ({ page }) => {
    // Legacy "Shipments (n)" — present on the search dashboard variant. The
    // module page renders <Lane title="Shipments"> without a count, so this is
    // exercised via the /planning left pane instead. Confirm in Phase A.
    test.fixme(true, 'confirm whether the Shipments module shows a count; see Phase A')
    await expect(page.getByText(/^Shipments \(\d+\)$/)).toBeVisible()
  })

  test('column sort toggles ascending/descending', async ({ page }) => {
    test.fixme(true, 'confirm sortable-header DOM + a sort indicator in Phase A')
    const sp = new ShipmentsPage(page)
    await sp.sortBy('Weight')
    // TODO: assert order changed (read first/last row weights) once selectors known.
  })

  test('FilterTabs: Assigned=Yes narrows the list', async ({ page }) => {
    test.fixme(true, 'confirm FilterTabs control DOM in Phase A')
    void page
  })

  test('saving and re-applying a personal filter @qa-mutating', async ({ page }) => {
    test.fixme(true, 'confirm saved-filter UI in Phase A')
    void page
  })

  test('clicking a shipment row opens the ShipmentDetail pane', async ({ page }) => {
    test.fixme(true, 'confirm ShipmentDetail pane DOM in Phase A')
    void page
  })
})
