import type { Page } from '@playwright/test'
import { test, expect, gateOnOnpremHealth } from './_shared'
import { DriverPlanningLayout } from './pages/DriverPlanningLayout'
import { PlanningPage } from './pages/PlanningPage'
import { TripDetailPage } from './pages/TripDetailPage'
import { TripsPage } from './pages/TripsPage'

// ---------------------------------------------------------------------------
// /driver-planning/trips/:tripId — the legacy Trip detail / itinerary view
// (ActivityGantt + Notes + status changes + activity-date edits + ShipmentDetail).
//
// Smoke + read-only interactions run normally. The write flows that used to sit
// here are gone by design, not parked — see
// plans/completed/longhaul-qa-mutating-triage.md: notes and activity-date edits
// moved to qa-api round-trips in tests/api/longhaul-qa.spec.ts, and the status
// transition was dropped as triple-covered (handler + qa-api + Trip/index.test.tsx).
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

  // Re-implemented (was `Dropped` per the In-Progress-driver-lock backlog item):
  // the Planning view now renders a read-only driver display (data-target
  // "driver-locked") in place of the typeahead when the loaded trip's
  // currentTrip.status?.status === 'In-Progress'. See
  // plans/completed/longhaul-in-progress-driver-lock.md and
  // apps/tenant-web/.../PendingTrips/TripDetail.tsx :: DriverTripDetail.
  test('Planning locks the driver field on an In-Progress trip', async ({ page, qaWebUrl }) => {
    // We need a trip whose status is In-Progress. The default Trips-list filter
    // already includes In-Progress; scan the rendered cards for one. Skip
    // cleanly if the QA DB happens to have none under that filter.
    const layout = new DriverPlanningLayout(page, qaWebUrl)
    await layout.openTab('Trips')
    const trips = new TripsPage(page)
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
    await trips.cards
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
      .catch(() => {})
    const inProgressCard = page.locator('[data-target="trip-card"][data-trip-status="In-Progress"]')
    test.skip(
      (await inProgressCard.count()) === 0,
      'no In-Progress trips in the QA DB under the default filter',
    )
    const tripId = await inProgressCard.first().getAttribute('data-trip-id')
    expect(tripId, 'In-Progress trip card has a data-trip-id').toBeTruthy()

    // Load Planning with ?tripId=<the In-Progress trip>.
    const pp = new PlanningPage(page, qaWebUrl)
    await pp.openWithTripId(tripId!)
    // Same SearchDashboard shell-mount sentinel + reload-retry pattern as
    // planning.spec.ts beforeEach — the Planning module's AppGuard fan-out can
    // stall on a cold-start tunnel.
    try {
      await pp.searchDashboard.waitFor({ state: 'visible', timeout: 15_000 })
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await pp.searchDashboard.waitFor({ state: 'visible', timeout: 45_000 }).catch(() => {})
    }
    test.skip(
      !(await pp.searchDashboard.isVisible()),
      'planning module did not mount (AppGuard still loading — on-prem fetch slow)',
    )

    // The driver-locked read-only display is rendered…
    const lockedDisplay = pp.pendingTrips.locator('[data-target="driver-locked"]')
    await expect(lockedDisplay).toBeVisible({ timeout: 30_000 })
    await expect(lockedDisplay).toContainText(/locked — trip in progress/i)
    // …and the typeahead is gone (not interactive — there's no <input> to focus).
    await expect(pp.driverTypeahead).toHaveCount(0)
  })
})
