import { test, expect, gateOnOnpremHealth } from './_shared'
import { PlanningPage } from './pages/PlanningPage'

// ---------------------------------------------------------------------------
// /driver-planning/planning — the core legacy trip-building workflow:
// search shipments → add to a pending trip → assign driver/dispatcher → manage
// activities → save → view itinerary → (cancel | new trip).
//
// Confident smoke checks run normally. The interaction-heavy flows depend on the
// ported PendingTrips / SearchDashboard / DriverTypeahead DOM and are
// `test.fixme`'d until the Phase A exploratory pass confirms selectors / adds
// data-testids. Write flows are tagged @qa-mutating (they create trips, etc. in
// the on-prem MSSQL DB — disposable in QA, re-seed before a full run).
// ---------------------------------------------------------------------------

test.describe('Planning tab', () => {
  test.beforeEach(async ({ page, qaWebUrl }) => {
    const layout = await gateOnOnpremHealth(page, qaWebUrl)
    await layout.openTab('Planning')
  })

  test('loads the three-pane trip builder with an empty pending trip @smoke', async ({ page }) => {
    const pp = new PlanningPage(page, '')
    await expect(pp.container).toBeVisible()
    await expect(pp.leftColumn).toBeVisible()
    await expect(pp.rightColumn).toBeVisible()
    await expect(pp.emptyPendingTrip).toBeVisible()
  })

  test('the search dashboard lists shipments from the on-prem DB @smoke', async ({ page }) => {
    const pp = new PlanningPage(page, '')
    await expect.poll(() => pp.shipmentCards().count(), { timeout: 15_000 }).toBeGreaterThan(0)
  })

  test('adding a shipment to the trip auto-generates PACK/LOAD/DELIVERY activities', async ({
    page,
  }) => {
    test.fixme(true, 'confirm ShipmentCard "+" + PendingTrips activity rows in Phase A')
    const pp = new PlanningPage(page, '')
    await pp.addFirstShipmentToTrip()
    await expect(pp.pendingTripShipments()).toHaveCount(1)
    // TODO: assert activity rows show PACK / LOAD / DELIVERY (or RDEL) labels.
  })

  test('assigns a driver via the typeahead and a dispatcher via the dropdown', async () => {
    test.fixme(true, 'confirm DriverTypeahead + Dispatcher dropdown DOM in Phase A')
  })

  test('add / edit-dates / delete activity; deleting the last removes the shipment', async () => {
    test.fixme(true, 'confirm AddActivity / EditActivity popovers + delete controls in Phase A')
  })

  test('navigating away with a dirty pending trip prompts "Leave page?"', async ({ page }) => {
    test.fixme(true, 'requires a working "add shipment" step first; confirm in Phase A')
    const pp = new PlanningPage(page, '')
    await pp.addFirstShipmentToTrip()
    await page.getByRole('link', { name: 'Trips', exact: true }).click()
    await expect(pp.leavePageDialog).toBeVisible()
    await expect(pp.discardChangesButton).toBeVisible()
    await pp.stayOnPageButton.click()
  })

  test('saving a trip with no shipments shows an error', async ({ page }) => {
    test.fixme(true, 'confirm Save button state + error snackbar copy in Phase A')
    const pp = new PlanningPage(page, '')
    await pp.saveButton.click()
    await expect(pp.snackbar).toContainText(/shipment/i)
  })

  test('saves a trip and navigates to its itinerary @qa-mutating', async ({ page }) => {
    test.fixme(true, 'end-to-end save flow — implement after the add/assign steps land')
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
    test.fixme(true, 'depends on the save flow; confirm the "clear current trip?" prompt')
  })

  test('"Cancel Trip" marks the trip canceled and returns its shipments @qa-mutating', async () => {
    test.fixme(true, 'depends on the save flow; confirm the ⋮ More-actions menu')
  })

  test('changing the dispatcher cascades to the shipments’ shadow @qa-mutating', async () => {
    test.fixme(true, 'verify operations_id/operations_name via GET /api/v1/longhaul/shipments/:id')
  })
})
