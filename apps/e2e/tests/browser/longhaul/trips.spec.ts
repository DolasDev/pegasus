import { test, expect, gateOnOnpremHealth } from './_shared'
import { TripsPage } from './pages/TripsPage'

// ---------------------------------------------------------------------------
// /driver-planning/trips — the legacy Trips list.
// Confident smoke checks run normally; filter/card interactions are `test.fixme`'d
// pending the Phase A pass (TripCard / TripsFilter DOM).
// ---------------------------------------------------------------------------

test.describe('Trips tab', () => {
  test.beforeEach(async ({ page, qaWebUrl }) => {
    const layout = await gateOnOnpremHealth(page, qaWebUrl)
    await layout.openTab('Trips')
  })

  test('loads the Trips list @smoke', async ({ page }) => {
    const tp = new TripsPage(page)
    await expect(tp.laneTitle).toBeVisible()
    await expect(tp.newTripButton).toBeVisible()
    // The known-good DB should have at least one trip under the default filter
    // (status ∈ {Pending, Accepted, Offered, In-Progress}, internal_status=active).
    // If it legitimately has none, the empty state must render instead.
    const cards = await tp.cardCount()
    if (cards === 0) await expect(tp.emptyState).toBeVisible()
    else expect(cards).toBeGreaterThan(0)
  })

  test('"New Trip" navigates to the planning page', async ({ page }) => {
    const tp = new TripsPage(page)
    await tp.newTripButton.click()
    await expect(page).toHaveURL(/\/driver-planning\/planning\b/)
  })

  test('changing the status filter updates the list', async () => {
    test.fixme(true, 'confirm TripsFilter control DOM in Phase A')
  })

  test('searching by trip title / number filters the list', async () => {
    test.fixme(true, 'confirm the trips search input in Phase A')
  })

  test('clicking a trip card opens its detail page', async ({ page }) => {
    test.fixme(true, 'confirm a stable TripCard selector / add data-testid in Phase A')
    const tp = new TripsPage(page)
    test.skip((await tp.cardCount()) === 0, 'no trips in the QA DB')
    await tp.cards.first().click()
    await expect(page).toHaveURL(/\/driver-planning\/trips\/\d+/)
  })
})
