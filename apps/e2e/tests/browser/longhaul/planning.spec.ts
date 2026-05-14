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
    // Same reload-retry recipe trips.spec.ts beforeEach uses — the Planning
    // module's AppGuard fan-out (/drivers, /dispatchers, /users/me, etc.) can
    // stall 30+ s on a cold-start tunnel, leaving the page stuck on
    // "Loading…" so every assertion times out. The SearchDashboard pane is
    // the shell-mount sentinel (renders before any /shipments data resolves).
    const pp = new PlanningPage(page, '')
    try {
      await pp.searchDashboard.waitFor({ state: 'visible', timeout: 15_000 })
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await pp.searchDashboard.waitFor({ state: 'visible', timeout: 45_000 }).catch(() => {})
    }
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

  test('assigns a driver via the typeahead and a dispatcher via the dropdown', async ({ page }) => {
    const pp = new PlanningPage(page, '')
    await expect(pp.pendingTrips).toBeVisible({ timeout: 30_000 })

    // -- driver typeahead (Downshift) --
    await pp.driverTypeaheadInput.click()
    await pp.driverTypeaheadInput.fill('a') // a common letter — matches many driver names
    // Downshift opens the menu on the input change; if the on-prem returned no
    // drivers there's nothing to pick (AppGuard's fetchDrivers thunk failed).
    await pp
      .driverTypeaheadOptions()
      .first()
      .waitFor({ state: 'visible', timeout: 8_000 })
      .catch(() => {})
    test.skip(
      (await pp.driverTypeaheadOptions().count()) === 0,
      'no drivers loaded (on-prem /drivers empty?)',
    )
    await pp.driverTypeaheadOptions().first().click()
    // The typeahead re-populates with the picked driver's name.
    await expect.poll(() => pp.driverTypeaheadInput.inputValue(), { timeout: 10_000 }).not.toBe('')

    // -- dispatcher react-select --
    await pp.dispatcherSelectInput.click()
    await pp
      .dispatcherSelectOptions()
      .first()
      .waitFor({ state: 'visible', timeout: 8_000 })
      .catch(() => {})
    test.skip(
      (await pp.dispatcherSelectOptions().count()) === 0,
      'no dispatchers loaded (on-prem /dispatchers empty?)',
    )
    await pp.dispatcherSelectOptions().first().click()
    await expect(pp.dispatcherSelectValue).toBeVisible()
    expect((await pp.dispatcherSelectValue.innerText()).trim().length).toBeGreaterThan(0)
  })

  test('add an activity, delete one, and deleting the last removes the shipment from the trip', async ({
    page,
  }) => {
    const pp = new PlanningPage(page, '')
    await expect.poll(() => pp.shipmentCards().count(), { timeout: 40_000 }).toBeGreaterThan(0)
    const orderNum = await pp.addFirstShipmentToTrip()
    const card = orderNum
      ? pp.pendingTrips.locator(
          `[data-target="pending-trip-shipment"][data-order-num="${orderNum}"]`,
        )
      : pp.pendingTripShipments().first()
    await expect(card).toBeVisible()
    // The shipment lands with its auto-generated activities (RDEL is always one).
    await expect.poll(() => pp.pendingActivities(card).count()).toBeGreaterThan(0)
    const n = await pp.pendingActivities(card).count()

    // The `.floatingDeleteButton` trash buttons are `display:none` except while
    // the shipment card is hovered (a CSS `:hover` rule Playwright's auto-hover
    // doesn't reliably hold across the click's actionability checks), so fire
    // the React onClick directly instead.
    const removeFirstActivity = async () => {
      await pp
        .pendingActivities(card)
        .first()
        .locator('[data-target="remove-activity"]')
        .dispatchEvent('click')
    }

    // -- add an activity from the AddActivity popover (the shipment's extras) --
    await pp.addActivityButton(card).click()
    await pp
      .addActivityOptions()
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .catch(() => {})
    if ((await pp.addActivityOptions().count()) > 0) {
      await pp.addActivityOptions().first().click()
      await expect.poll(() => pp.pendingActivities(card).count()).toBe(n + 1)
      // …and remove it again.
      await removeFirstActivity()
      await expect.poll(() => pp.pendingActivities(card).count()).toBe(n)
    }

    // -- delete every remaining activity; removing the last one drops the shipment --
    for (let remaining = await pp.pendingActivities(card).count(); remaining > 0; remaining--) {
      await removeFirstActivity()
    }
    await expect(card).toBeHidden()
    await expect(pp.emptyPendingTrip).toBeVisible()
  })

  test('saving a trip with no shipments shows an error', async ({ page }) => {
    const pp = new PlanningPage(page, '')
    // An empty pending trip is the default state; confirm it, then Save → the
    // bridge rejects a shipment-less trip with 403 "Trip must have shipments",
    // which PendingTrips surfaces via the error Snackbar.
    await expect(pp.emptyPendingTrip).toBeVisible({ timeout: 30_000 })
    await pp.saveButton.click()
    await expect(pp.snackbar).toBeVisible({ timeout: 25_000 })
    await expect(pp.snackbar).toContainText(/shipment/i)
  })

  test('saves a trip and navigates to its itinerary @qa-mutating', async ({ page, qaWebUrl }) => {
    const pp = new PlanningPage(page, qaWebUrl)
    // beforeEach already did the reload-retry and waited on searchDashboard;
    // skip cleanly if it ultimately never mounted (rare on-prem outage).
    test.skip(
      !(await pp.searchDashboard.isVisible()),
      'planning module did not mount (AppGuard still loading — on-prem fetch slow)',
    )
    await expect.poll(() => pp.shipmentCards().count(), { timeout: 30_000 }).toBeGreaterThan(0)
    const orderNum = await pp.addFirstShipmentToTrip()
    expect(orderNum, 'first shipment in search dashboard has an order_num').toBeTruthy()
    // The shipment shows up in the pending-trip pane.
    await expect(pp.pendingTripShipments()).toHaveCount(1, { timeout: 15_000 })

    // Assign a driver: Downshift only opens the option list on an input-value
    // change (not on focus), so type a common letter before polling — matches
    // the pattern used in the read-only typeahead test above. Skip cleanly if
    // /drivers came back empty (on-prem 503 — already gated on elsewhere).
    await pp.driverTypeaheadInput.click()
    await pp.driverTypeaheadInput.fill('a')
    await pp
      .driverTypeaheadOptions()
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
      .catch(() => {})
    test.skip(
      (await pp.driverTypeaheadOptions().count()) === 0,
      'no drivers loaded (on-prem /drivers empty or 503)',
    )
    await pp.driverTypeaheadOptions().first().click()

    // 3. Save. The trip POSTs and the redux thunk on success triggers a
    // snackbar containing "saved" (matches the case-insensitive pattern below).
    await pp.saveButton.click()
    await expect(pp.snackbar).toBeVisible({ timeout: 30_000 })
    await expect(pp.snackbar).toContainText(/saved/i)

    // 4. Click View Itinerary → the URL should be /driver-planning/trips/<id>.
    await pp.viewItineraryLink.click()
    await expect(page).toHaveURL(/\/driver-planning\/trips\/\d+/, { timeout: 15_000 })
  })

  // Removed per plans/todo/longhaul-qa-mutating-triage.md (Phase 7):
  // - "re-opens a saved trip via ?tripId=" → covered by container test
  //   `routes/PlanningModule.test.tsx` (verifies initializeTripPage dispatch
  //   with the parsed tripId, no on-prem dependency).
  // - "New Trip clears the current pending trip after confirmation" → covered
  //   by container test `containers/PendingTrips/index.test.tsx` (verifies the
  //   store state resets to a fresh pending trip after the confirm click).
  // - "Cancel Trip marks the trip canceled and returns its shipments" → moved
  //   to `tests/api/longhaul-qa.spec.ts` "POST /trips → cancel" round-trip.
  // - "changing the dispatcher cascades to the shipments' shadow" → moved to
  //   `tests/api/longhaul-qa.spec.ts` "PATCH /shipments/:id/shadow" round-trip;
  //   reshape-shipment.test.ts + Shipments container test cover the read side.
})
