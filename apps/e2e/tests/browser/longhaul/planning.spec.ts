import { test, expect, gateOnOnpremHealth } from './_shared'
import { PlanningPage } from './pages/PlanningPage'

// ---------------------------------------------------------------------------
// /driver-planning/planning — the core legacy trip-building workflow:
// search shipments → add to a pending trip → assign driver/dispatcher → manage
// activities → save → view itinerary → (cancel | new trip).
//
// Selectors target the `data-target` hooks added to the ported components.
// Write flows that hit the on-prem MSSQL DB are tagged @qa-mutating (disposable
// in QA, re-seed before a full run) and stay `test.fixme`'d until the QA-app
// walkthrough confirms the full save round-trip.
// ---------------------------------------------------------------------------

test.describe('Planning tab', () => {
  test.beforeEach(async ({ page, qaWebUrl, qaApiFetch }) => {
    const layout = await gateOnOnpremHealth(page, qaWebUrl, qaApiFetch)
    await layout.openTab('Planning')
  })

  test('loads the three-pane trip builder with an empty pending trip @smoke', async ({ page }) => {
    const pp = new PlanningPage(page, '')
    await expect(pp.container).toBeVisible()
    await expect(pp.searchDashboard).toBeVisible()
    await expect(pp.pendingTrips).toBeVisible()
    await expect(pp.emptyPendingTrip).toBeVisible()
  })

  test('the search dashboard lists shipments from the on-prem DB', async ({ page }) => {
    // Not @smoke — fails (not skips) when empty / on a /shipments 504; that's a
    // real finding about the QA DB / on-prem query, not a test problem.
    const pp = new PlanningPage(page, '')
    await expect.poll(() => pp.shipmentCards().count(), { timeout: 40_000 }).toBeGreaterThan(0)
  })

  test('adding a shipment to the trip auto-generates its activities', async ({ page }) => {
    const pp = new PlanningPage(page, '')
    await expect.poll(() => pp.shipmentCards().count(), { timeout: 40_000 }).toBeGreaterThan(0)
    const orderNum = await pp.addFirstShipmentToTrip()

    const card = orderNum
      ? pp.pendingTrips.locator(
          `[data-target="pending-trip-shipment"][data-order-num="${orderNum}"]`,
        )
      : pp.pendingTripShipments().first()
    await expect(card).toBeVisible()
    await expect(pp.emptyPendingTrip).toBeHidden()

    // The on-prem /shipments response carries the required activity templates
    // (apps/api/src/lib/longhaul-build-activities.ts: PACK + LOAD-or-R19O + RDEL —
    // PACK/LOAD are suppressed for rule19 dock-pickup shipments). They render as
    // activity rows the instant the shipment lands in the trip; RDEL is always one.
    const activities = pp.pendingActivities(card)
    await expect.poll(() => activities.count()).toBeGreaterThan(0)
    const abbrs = await activities.evaluateAll((els) =>
      els.map((e) => (e.getAttribute('data-activity-abbr') ?? '').toUpperCase()),
    )
    expect(abbrs.some((a) => /RDEL|DEL/.test(a))).toBeTruthy()
    expect(abbrs.some((a) => /PACK|LOAD|R19O|R19I/.test(a))).toBeTruthy()
  })

  test('navigating away with a dirty pending trip prompts "Leave page?"', async ({ page }) => {
    const pp = new PlanningPage(page, '')
    await expect.poll(() => pp.shipmentCards().count(), { timeout: 40_000 }).toBeGreaterThan(0)
    await pp.addFirstShipmentToTrip()
    await expect(pp.pendingTripShipments().first()).toBeVisible()

    await page.getByRole('link', { name: 'Trips', exact: true }).click()
    await expect(pp.leavePageDialog).toBeVisible()
    await expect(pp.discardChangesButton).toBeVisible()
    await pp.stayOnPageButton.click()
    // Stayed put — still on the planning page with the shipment in the trip.
    await expect(page).toHaveURL(/\/driver-planning\/planning\b/)
    await expect(pp.pendingTripShipments().first()).toBeVisible()
  })

  test('assigns a driver via the typeahead and a dispatcher via the dropdown', async () => {
    test.fixme(true, 'walkthrough: confirm DriverTypeahead option list + dispatcher react-select')
  })

  test('add / edit-dates / delete activity; deleting the last removes the shipment', async () => {
    test.fixme(true, 'walkthrough: confirm AddActivity options + EditActivity popover behaviour')
  })

  test('saving a trip with no shipments shows an error', async ({ page }) => {
    test.fixme(true, 'walkthrough: confirm the legacy 403 "trip without shipments" snackbar copy')
    const pp = new PlanningPage(page, '')
    await pp.saveButton.click()
    await expect(pp.snackbar).toContainText(/shipment/i)
  })

  test('saves a trip and navigates to its itinerary @qa-mutating', async ({ page }) => {
    test.fixme(true, 'end-to-end save flow — implement after the assign-driver step lands')
    const pp = new PlanningPage(page, '')
    await pp.addFirstShipmentToTrip()
    // ...assign driver...
    await pp.saveButton.click()
    await expect(pp.snackbar).toContainText(/saved/i)
    await pp.viewItineraryLink.click()
    await expect(page).toHaveURL(/\/driver-planning\/trips\/\d+/)
  })

  test('re-opens a saved trip via ?tripId= with its shipments pre-loaded @qa-mutating', async () => {
    test.fixme(true, 'depends on the save flow; verify the ?tripId= query param survived the port')
  })

  test('"New Trip" clears the current pending trip after confirmation @qa-mutating', async () => {
    test.fixme(true, 'depends on the save flow; confirm the "Start a new trip?" confirm dialog')
  })

  test('"Cancel Trip" marks the trip canceled and returns its shipments @qa-mutating', async () => {
    test.fixme(true, 'depends on the save flow; uses the ⋮ data-target="more-trip-actions" menu')
  })

  test('changing the dispatcher cascades to the shipments’ shadow @qa-mutating', async () => {
    test.fixme(
      true,
      'verify operations_id/operations_name via GET /api/v1/onprem/longhaul/shipments/:id',
    )
  })
})
