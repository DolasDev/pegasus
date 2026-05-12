import { test, expect, gateOnOnpremHealth } from './_shared'
import { DriverPlanningLayout } from './pages/DriverPlanningLayout'
import { TripDetailPage } from './pages/TripDetailPage'
import { TripsPage } from './pages/TripsPage'

// ---------------------------------------------------------------------------
// /driver-planning/trips/:tripId — the legacy Trip detail / itinerary view
// (ActivityGantt + Notes + status changes + activity-date edits + ShipmentDetail).
//
// A smoke check (open the first trip from the list, the Gantt renders) runs
// normally; the deeper interactions are `test.fixme`'d until Phase A confirms
// the ActivityGantt / Notes / status-dropdown DOM. Write flows are @qa-mutating.
// ---------------------------------------------------------------------------

test.describe('Trip detail', () => {
  test.beforeEach(async ({ page, qaWebUrl }) => {
    await gateOnOnpremHealth(page, qaWebUrl)
  })

  test('opens a known-good trip and renders the activity Gantt @smoke', async ({
    page,
    qaWebUrl,
  }) => {
    // Find a trip id from the list, then deep-link to its detail page.
    const layout = new DriverPlanningLayout(page, qaWebUrl)
    await layout.openTab('Trips')
    const trips = new TripsPage(page)
    test.skip((await trips.cardCount()) === 0, 'no trips in the QA DB to open')

    const href = await trips.cards.first().getAttribute('href')
    const tripId = href?.match(/\/trips?\/(\d+)/)?.[1]
    test.skip(
      !tripId,
      'could not derive a trip id from the first card; confirm TripCard href in Phase A',
    )

    const detail = new TripDetailPage(page, qaWebUrl)
    await detail.goto(tripId!)
    await expect(detail.gantt).toBeVisible({ timeout: 15_000 })
  })

  test('trip notes: existing render, add a note, edit it @qa-mutating', async () => {
    test.fixme(true, 'confirm Notes component DOM in Phase A')
  })

  test('editing an activity date persists @qa-mutating', async () => {
    test.fixme(true, 'confirm ActivityGantt activity rows + date-change prompt in Phase A')
  })

  test('changing trip status persists; an illegal transition is rejected @qa-mutating', async () => {
    test.fixme(true, 'confirm the status dropdown + status-prediction prompt in Phase A')
  })

  test('driver field is read-only once the trip is In-Progress', async () => {
    test.fixme(true, 'needs a trip in In-Progress status; confirm the driver-field lock in Phase A')
  })

  test('clicking a shipment opens ShipmentDetail with a linked order number', async () => {
    test.fixme(true, 'confirm ShipmentDetail pane + order# link target in Phase A')
  })
})
