import { test, expect, type Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Trip dateContainer — deterministic visual-regression spec.
//
// The Trip Itinerary "dateContainer" (fixed left activity-card column +
// ActivityGantt) is a port of apps/longhaul. Its layout leans on a magic
// `margin-top: 53px` tuned to a browser-default <h5> header height — which
// tenant-web's Tailwind Preflight reset had collapsed, knocking the two
// columns out of row-alignment. These screenshots lock that alignment (and the
// font/heading rendering) against regression.
//
// DETERMINISTIC BY DESIGN: every /driver-planning/* network call is stubbed
// with fixed fixtures via page.route, so the render is independent of the QA
// on-prem tunnel and live data. `reshapeTrip` is defensive (no-ops on
// already-nested input), so the stub returns the component-shaped trip directly
// inside the `{ data }` envelope that tenant-web's apiFetch unwraps.
//
// CI: tagged `@local-only` so the deployed E2E gates (remote/qa) exclude it via
// `grepInvert: /@local-only/` — it needs a logged-in tenant-web dev server, which
// those unauthenticated, API-only gates don't provide. PR CI now serves a built
// tenant-web at WEB_URL for the core-flow browser specs, but the screenshot
// baselines here are recorded on a dev laptop and are machine-dependent (no
// linux baselines committed), so this spec additionally requires the explicit
// `E2E_VISUAL=true` opt-in and stays a manual layout-drift checker.
//
// RUNNING (manual):
//   1. Start a logged-in tenant-web dev server:  cd apps/tenant-web && npm run dev
//   2. First run records the golden baseline:
//        cd apps/e2e && E2E_VISUAL=true WEB_URL=http://localhost:5173 \
//          npx playwright test trip-date-container --update-snapshots
//      Review the generated PNGs (fixed-column rows aligned to the gantt rows,
//      bold/sized headings, Open Sans) before committing them. The original
//      apps/longhaul reference app was removed in the same change that landed
//      these fixes — see its last state in git history if a visual diff is
//      needed.
//   3. Subsequent runs assert against the baseline:
//        cd apps/e2e && E2E_VISUAL=true WEB_URL=http://localhost:5173 \
//          npx playwright test trip-date-container
// ---------------------------------------------------------------------------

const WEB_URL = process.env['WEB_URL']
const TRIP_ID = 4242

test.skip(
  !WEB_URL || process.env['E2E_VISUAL'] !== 'true',
  'E2E_VISUAL/WEB_URL not set — machine-dependent visual spec is manual-only (see file header)',
)

// Component-shaped trip (already nested → reshapeTrip no-ops). Two shipment
// activities, one VIP, deterministic dates so day-headers and bar offsets are
// stable across runs.
const tripFixture = {
  id: TRIP_ID,
  trip_title: 'Visual-Baseline',
  driver_name: 'Big Rig',
  driver: { driver_name: 'Big Rig' },
  planner: { first_name: 'PA', last_name: 'PB' },
  dispatcher: { first_name: 'DA', last_name: 'DB' },
  total_estimated_lbs: 1000,
  total_actual_lbs: 1100,
  total_estimated_linehaul_usd: 5000,
  status: { status: 'Pending' },
  notes: [],
  activities: [
    {
      activityId: 1,
      order_num: 'O1',
      city: 'DALLAS',
      state: 'TX',
      planned_start: '2024-01-01T00:00:00Z',
      planned_end: '2024-01-01T00:00:00Z',
      estimated_date: null,
      actual_date: null,
      is_committed: false,
      is_confirmed: false,
      activityType: { abbreviation: 'WH', code: 'WHSE', isHasETA: false },
      shipment: {
        shipper_name: 'SMITH, JOHN',
        order_num: 'O1',
        vip: 'Y',
        idc_break: 'N',
        total_est_wt: 5000,
        pegasus_shadow: null,
      },
    },
    {
      activityId: 2,
      order_num: 'O2',
      city: 'AUSTIN',
      state: 'CA',
      planned_start: '2024-01-02T00:00:00Z',
      planned_end: '2024-01-02T00:00:00Z',
      estimated_date: null,
      actual_date: null,
      is_committed: false,
      is_confirmed: false,
      activityType: { abbreviation: 'DL', code: 'WHSE', isHasETA: false },
      shipment: {
        shipper_name: 'DOE, JANE',
        order_num: 'O2',
        vip: 'N',
        idc_break: 'N',
        total_est_wt: 3000,
        pegasus_shadow: null,
      },
    },
  ],
}

/** Stub the whole longhaul bridge surface so AppGuard's reference-data bootstrap
 *  + the trip fetch resolve deterministically offline. apiFetch unwraps `{ data }`. */
async function stubLonghaul(page: Page): Promise<void> {
  await page.route('**/api/v1/onprem/longhaul/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.split('/api/v1/onprem/longhaul')[1] ?? ''
    const json = (data: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data }),
      })

    if (/^\/trips\/\d+$/.test(path)) return json(tripFixture)
    if (/^\/trips\/\d+\/summary$/.test(path)) return json({})
    if (path === '/users/me') return json({ windows_user: 'e2e', driver_name: 'E2E' })
    if (path === '/version') return json({ version: 'e2e' })
    // Reference-data lists AppGuard fans out to (drivers / trip-statuses /
    // states / zones / planners / dispatchers / filter-options) — empty is fine.
    return json([])
  })
}

test.describe('Trip dateContainer visual parity @local-only', () => {
  test.beforeEach(async ({ page }) => {
    await stubLonghaul(page)
    await page.goto(`${WEB_URL}/driver-planning/trips/${TRIP_ID}`, {
      waitUntil: 'domcontentloaded',
    })
    // Shell mounted + trip data rendered.
    await expect(page.locator('[data-target="activity-gantt"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-target="trip-shipment-activity"]')).toHaveCount(2)
  })

  test('dateContainer renders with the fixed column row-aligned to the gantt @visual', async ({
    page,
  }) => {
    // dateContainer is the direct parent of the gantt (sibling of the fixed
    // card column in Trip/index.tsx) — capturing it shows both columns together,
    // which is exactly where the alignment regression would show.
    const dateContainer = page.locator('[data-target="activity-gantt"]').locator('..')
    await expect(dateContainer).toHaveScreenshot('date-container.png')
  })

  test('gantt date-header row keeps its height @visual', async ({ page }) => {
    const header = page.locator('[data-target="activity-gantt"]')
    await expect(header).toHaveScreenshot('activity-gantt.png')
  })
})
