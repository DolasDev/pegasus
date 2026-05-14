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

/** Open the first trip from the Trips list and return its detail PO + id.
 *  Both the Trips list (`/longhaul/trips`) and the detail (`/longhaul/trips/:id`)
 *  go through the on-prem proxy and intermittently stall / 5xx. Soft-skip
 *  when either sentinel fails to appear; if the trip *did* load and only the
 *  gantt is missing, the spec's gantt assertion still fails loud. */
async function openFirstTrip(page: Page, qaWebUrl: string) {
  const layout = new DriverPlanningLayout(page, qaWebUrl)
  await layout.openTab('Trips')
  const trips = new TripsPage(page)
  // Same reload-retry recipe trips.spec.ts beforeEach uses — wait on the
  // newTripButton (shell-mount sentinel) rather than the laneTitle (which
  // requires the data fetch to resolve and the count to render). On a
  // congested AppGuard bootstrap the data fetch can lag the shell by 30+ s.
  try {
    await trips.newTripButton.waitFor({ state: 'visible', timeout: 15_000 })
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await trips.newTripButton.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
  }
  test.skip(
    !(await trips.newTripButton.isVisible()),
    'Trips module did not mount (on-prem AppGuard bootstrap slow or 5xx after retry)',
  )
  // Give the cards a fair chance to stream in after the shell mounts before
  // skip-on-no-cards fires below.
  await trips.cards
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .catch(() => {})
  const tripId = await trips.firstTripId()
  test.skip(tripId === null, 'no trips in the QA DB under the default filter')
  const detail = new TripDetailPage(page, qaWebUrl)
  await detail.goto(tripId!)
  await detail.backToTripsButton.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
  test.skip(
    !(await detail.backToTripsButton.isVisible()),
    'trip detail did not load (on-prem /trips/:id slow or 5xx)',
  )
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

  // Removed per plans/todo/longhaul-qa-mutating-triage.md (Phase 7):
  // - "trip notes: existing render, add a note, edit it" → moved to qa-api
  //   round-trip in `tests/api/longhaul-qa.spec.ts`. UI modal mechanics are
  //   covered by `containers/Trip/components/Notes/Notes.test.tsx`.
  // - "editing an activity date persists" → covered by qa-api
  //   "POST /activities then GET /activities" round-trip. UI popover open is
  //   covered by `containers/Trip/components/ActivityGantt/ActivityGantt.test.tsx`.

  // Dropped: "changing trip status persists; an illegal transition is rejected"
  // — handler tests in apps/api/src/handlers/longhaul/trips.test.ts cover
  // PATCH /trips/:id/status (happy + 404); longhaul-qa.spec.ts:143 covers the
  // 404 reject end-to-end. Trip/index.test.tsx covers the step-rail render.
  // Triple-covered already; a browser spec adds no signal. See
  // plans/todo/longhaul-qa-mutating-triage.md.

  // Dropped: the legacy app gated driver-edit on In-Progress status; the port
  // doesn't carry that lock — `DriverTripDetail` (Planning) has no `isInProgress`
  // check, and the trip-detail page never renders a driver-edit affordance to
  // begin with. Tracking as a missing-feature-parity backlog item rather than a
  // test gap. See plans/todo/longhaul-in-progress-driver-lock.md.
})
