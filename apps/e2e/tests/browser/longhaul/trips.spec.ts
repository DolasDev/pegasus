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
    await expect(tp.newTripButton).toBeVisible({ timeout: 25_000 })
  })

  test('the Trips lane renders (with cards or the empty state)', async ({ page }) => {
    const tp = new TripsPage(page)
    // The "Trips (n)" lane heading is always rendered once <Trips> mounts; with
    // 0 trips it sits alongside the "No trips found" empty state, with >0 it sits
    // above the cards. Default filter: status ∈ {Pending,Accepted,Offered,In-Progress}.
    // On a congested on-prem run the AppGuard bootstrap can stretch past 30s —
    // one reload-retry dodges that before treating a missing lane as real.
    try {
      await tp.laneTitle.waitFor({ state: 'visible', timeout: 15_000 })
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await tp.laneTitle.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
    }
    await expect(tp.laneTitle).toBeVisible({ timeout: 30_000 })
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
    await expect(tp.laneTitle).toBeVisible({ timeout: 30_000 })
    const tripId = await tp.firstTripId()
    test.skip(tripId === null, 'no trips in the QA DB under the default filter')
    await tp.openTrip(tripId!)
    await expect(page).toHaveURL(new RegExp(`/driver-planning/trips/${tripId}\\b`))
  })

  test('adding a status to the filter widens the trip list', async ({ page }) => {
    const tp = new TripsPage(page)
    await expect(tp.laneTitle).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => tp.cardCount(), { timeout: 30_000 }).toBeGreaterThan(0)
    const before = await tp.cardTripIds()

    // The default status filter is [Pending, Accepted, Offered, In-Progress];
    // pick the first not-yet-selected status the dropdown offers (e.g.
    // Completed/Finalized) — react-select hides selected options, so the menu
    // only lists statuses that would widen the list.
    await tp.pickFirstFilterOption('TripStatus_id')

    // The list re-fetches (debounced ~300ms) to a superset.
    await expect
      .poll(
        async () => {
          const after = await tp.cardTripIds()
          return after.length >= before.length && before.every((id) => after.includes(id))
        },
        { timeout: 30_000 },
      )
      .toBe(true)
  })

  test('filtering by Trip Id narrows the list to that one trip', async ({ page }) => {
    const tp = new TripsPage(page)
    await expect(tp.laneTitle).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => tp.cardCount(), { timeout: 30_000 }).toBeGreaterThan(0)
    const total = await tp.cardCount()
    const tripId = await tp.firstTripId()

    await tp.tripIdInput.fill(tripId!)
    // Debounced ~300ms → fetchTrips with an exact `id=` filter → one trip.
    await expect.poll(() => tp.cardCount(), { timeout: 30_000 }).toBe(1)
    expect(await tp.firstTripId()).toBe(tripId)

    await tp.tripIdInput.fill('')
    await expect.poll(() => tp.cardCount(), { timeout: 30_000 }).toBe(total)
  })
})
