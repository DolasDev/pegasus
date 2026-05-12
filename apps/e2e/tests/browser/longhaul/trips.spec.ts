import { test, expect, gateOnOnpremHealth } from './_shared'
import { TripsPage } from './pages/TripsPage'

// ---------------------------------------------------------------------------
// /driver-planning/trips — the legacy Trips list.
// Selectors target the `data-target` hooks added to TripCard / the Trips lane.
// Filter-control interactions stay `test.fixme`'d pending the QA-app walkthrough
// (TripsFilter is react-select-heavy).
// ---------------------------------------------------------------------------

test.describe('Trips tab', () => {
  test.beforeEach(async ({ page, qaWebUrl, qaApiFetch }) => {
    const layout = await gateOnOnpremHealth(page, qaWebUrl, qaApiFetch)
    await layout.openTab('Trips')
  })

  test('loads the Trips list @smoke', async ({ page }) => {
    const tp = new TripsPage(page)
    await expect(page).toHaveURL(/\/driver-planning\/trips\b/)
    await expect(tp.newTripButton).toBeVisible({ timeout: 15_000 })
  })

  test('the Trips lane renders (with cards or the empty state)', async ({ page }) => {
    const tp = new TripsPage(page)
    // The "Trips (n)" lane heading is always rendered once <Trips> mounts; with
    // 0 trips it sits alongside the "No trips found" empty state, with >0 it sits
    // above the cards. Default filter: status ∈ {Pending,Accepted,Offered,In-Progress}.
    await expect(tp.laneTitle).toBeVisible({ timeout: 20_000 })
    if ((await tp.cardCount()) === 0) {
      await expect(tp.emptyState).toBeVisible()
    } else {
      await expect(tp.cards.first()).toBeVisible()
    }
  })

  test('"New Trip" navigates to the planning page', async ({ page }) => {
    const tp = new TripsPage(page)
    await tp.newTripButton.click()
    await expect(page).toHaveURL(/\/driver-planning\/planning\b/)
  })

  test('clicking a trip card opens its detail page', async ({ page }) => {
    const tp = new TripsPage(page)
    await expect(tp.laneTitle).toBeVisible({ timeout: 20_000 })
    const tripId = await tp.firstTripId()
    test.skip(tripId === null, 'no trips in the QA DB under the default filter')
    await tp.openTrip(tripId!)
    await expect(page).toHaveURL(new RegExp(`/driver-planning/trips/${tripId}\\b`))
  })

  test('changing the status filter updates the list', async () => {
    test.fixme(true, 'walkthrough: drive the TripsFilter react-select status control')
  })

  test('searching by trip title / number filters the list', async () => {
    test.fixme(true, 'walkthrough: confirm the trips search input + debounce')
  })
})
