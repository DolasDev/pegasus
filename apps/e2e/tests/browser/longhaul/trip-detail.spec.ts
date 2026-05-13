import type { Page } from '@playwright/test'
import { test, expect, gateOnOnpremHealth } from './_shared'
import { DriverPlanningLayout } from './pages/DriverPlanningLayout'
import { TripDetailPage } from './pages/TripDetailPage'
import { TripsPage } from './pages/TripsPage'

// ---------------------------------------------------------------------------
// /driver-planning/trips/:tripId — the legacy Trip detail / itinerary view
// (ActivityGantt + Notes + status changes + activity-date edits + ShipmentDetail).
//
// Smoke + read-only interactions run normally. Write flows (notes, status, date
// edits) are @qa-mutating and stay `test.fixme`'d until the QA-app walkthrough
// confirms the popover/prompt behaviour against the live app.
// ---------------------------------------------------------------------------

/** Open the first trip from the Trips list and return its detail PO + id. */
async function openFirstTrip(page: Page, qaWebUrl: string) {
  const layout = new DriverPlanningLayout(page, qaWebUrl)
  await layout.openTab('Trips')
  const trips = new TripsPage(page)
  await expect(trips.laneTitle).toBeVisible({ timeout: 30_000 })
  const tripId = await trips.firstTripId()
  test.skip(tripId === null, 'no trips in the QA DB under the default filter')
  const detail = new TripDetailPage(page, qaWebUrl)
  await detail.goto(tripId!)
  return { detail, tripId: tripId! }
}

test.describe('Trip detail', () => {
  test.beforeEach(async ({ page, qaWebUrl, qaApiFetch }) => {
    await gateOnOnpremHealth(page, qaWebUrl, qaApiFetch)
  })

  test('opens a known-good trip and renders the activity Gantt @smoke', async ({
    page,
    qaWebUrl,
  }) => {
    const { detail } = await openFirstTrip(page, qaWebUrl)
    await expect(detail.gantt).toBeVisible({ timeout: 30_000 })
    await expect(detail.notes).toBeVisible()
    await expect(detail.statusSteps.first()).toBeVisible()
    // Exactly one status step is marked active.
    await expect(detail.activeStatusStep).toHaveCount(1)
  })

  test('clicking a trip shipment opens the ShipmentDetail pane', async ({ page, qaWebUrl }) => {
    const { detail } = await openFirstTrip(page, qaWebUrl)
    await expect(detail.gantt).toBeVisible({ timeout: 30_000 })
    test.skip(
      (await detail.shipmentActivityCards.count()) === 0,
      'this trip has no shipment activities',
    )
    await expect(detail.shipmentDetailPane).toHaveAttribute('data-open', 'false')
    await detail.shipmentActivityCards.first().click()
    await expect(detail.shipmentDetailPane).toHaveAttribute('data-open', 'true', {
      timeout: 25_000,
    })
    await expect(detail.shipmentDetailField('Shipper Name')).toBeVisible()
  })

  test('trip notes: existing render, add a note, edit it @qa-mutating', async () => {
    test.fixme(true, 'walkthrough: Notes is an Expandable; confirm expand + the add/edit modal')
  })

  test('editing an activity date persists @qa-mutating', async () => {
    test.fixme(true, 'walkthrough: confirm the ActivityGantt date-change popover + reload-persists')
  })

  test('changing trip status persists; an illegal transition is rejected @qa-mutating', async () => {
    test.fixme(true, 'walkthrough: confirm the status-prediction prompt before the change commits')
  })

  // Dropped: the legacy app gated driver-edit on In-Progress status; the port
  // doesn't carry that lock — `DriverTripDetail` (Planning) has no `isInProgress`
  // check, and the trip-detail page never renders a driver-edit affordance to
  // begin with. Tracking as a missing-feature-parity backlog item rather than a
  // test gap. See plans/todo/longhaul-in-progress-driver-lock.md.
})
