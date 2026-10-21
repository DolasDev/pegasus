import { test, expect, type Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Services board (formerly Dispatch Activities): a selected service card opens
// the Shipment Detail drawer, and the card's trip number links to the trip.
//
// The drawer is `position: absolute` and sized against `.driver-planning-root`.
// The Services layout pins that root's height the same way Planning does, so
// it needs the same drawer rule in styles.css. Without that rule the drawer
// spills past the root and hands scrolling back to <main>. This spec pins the
// geometry as well as the behavior.
//
// DETERMINISTIC BY DESIGN: every /onprem/longhaul/* call is stubbed via
// page.route, mirroring trip-notes-visibility.spec.ts. Tagged `@local-only`: it
// needs the SKIP_AUTH e2e-mode tenant-web build served at WEB_URL.
// ---------------------------------------------------------------------------

const WEB_URL = process.env['WEB_URL']
const ORDER_NUM = 70707
const TRIP_ID = 4545

test.skip(!WEB_URL, 'WEB_URL not set — needs a served e2e-mode tenant-web build')

const activityRow = {
  id: 1,
  order_num: ORDER_NUM,
  TripMaster_id: TRIP_ID,
  ActivityType_code: 'PACK',
  estimated_date: null,
  scheduled_date: '2026-10-21T00:00:00.000Z',
  actual_date: null,
  planned_start: '2026-10-21T00:00:00.000Z',
  planned_end: '2026-10-21T00:00:00.000Z',
  status: 'Scheduled',
  street: '1 Main St',
  city: 'CHICAGO',
  state: 'IL',
  activity_type_name: 'Pack',
  activity_type_abbreviation: 'Pack',
  driver_name: 'Big Rig',
  shipper_name: 'SERVICES, SHIPPER',
  origin_city: 'CHICAGO',
  origin_state: 'IL',
  destination_city: 'DALLAS',
  destination_state: 'TX',
  haul_mode: 'N',
  dispatcher_last_name: 'Desk',
  total_est_wt: 4200,
}

const shipmentRow = {
  order_num: ORDER_NUM,
  shipper_name: 'SERVICES, SHIPPER',
  shipper_city: 'CHICAGO',
  shipper_state: 'IL',
  consignee_city: 'DALLAS',
  consignee_state: 'TX',
  TripMaster_id: TRIP_ID,
}

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

    if (path === '/activities') return json([activityRow])
    if (path === '/shipments') return json([shipmentRow])
    if (path === '/users/me') return json({ windows_user: 'e2e', driver_name: 'E2E' })
    if (path === '/version') return json({ version: 'e2e' })
    return json([])
  })
  // The board waits on the user's saved default before mounting. Stubbed as
  // "no default" so this spec runs the normal path, not the error fallback.
  await page.route('**/api/v1/services-filters/default', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":null}' }),
  )
}

test.describe('Services board opens the shipment detail drawer @local-only', () => {
  test.beforeEach(async ({ page }) => {
    await stubLonghaul(page)
    await page.goto(`${WEB_URL}/driver-planning/activities`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-target="activity-card"]')).toBeVisible({ timeout: 30_000 })
  })

  test('selecting a card opens the drawer on that order, on-screen', async ({ page }) => {
    const drawer = page.locator('[data-target="shipment-detail"]')
    await expect(drawer).toHaveAttribute('data-open', 'false')

    await page.locator('[data-target="activity-card"]').click()

    await expect(drawer).toHaveAttribute('data-open', 'true')
    await expect(drawer).toContainText('SERVICES, SHIPPER')

    // Let the 0.5s slide-in transition settle before measuring.
    await page.waitForTimeout(700)
    const geom = await page.evaluate(() => {
      const root = document.querySelector('.driver-planning-root') as HTMLElement | null
      const d = document.querySelector('[data-target="shipment-detail"]') as HTMLElement | null
      if (!root || !d) return null
      const r = root.getBoundingClientRect()
      const b = d.getBoundingClientRect()
      return {
        rootBottom: r.bottom,
        rootRight: r.right,
        bottom: b.bottom,
        right: b.right,
        width: b.width,
      }
    })
    expect(geom, 'root and drawer must both be present').not.toBeNull()
    const g = geom!
    expect(g.width).toBeGreaterThan(100)
    expect(g.right, 'drawer must not sit past the right edge').toBeLessThanOrEqual(g.rootRight + 1)
    expect(
      g.bottom,
      'drawer must span the pinned root, not spill out the bottom',
    ).toBeLessThanOrEqual(g.rootBottom + 1)

    await page.locator('[data-target="close-shipment-detail"]').click()
    await expect(drawer).toHaveAttribute('data-open', 'false')
  })

  test('the trip number links to the trip screen', async ({ page }) => {
    await page.locator('[data-target="activity-trip-link"]').click()

    await expect(page).toHaveURL(new RegExp(`/driver-planning/trips/${TRIP_ID}$`))
  })

  test('following the trip link with the drawer open lands on the trip with it closed', async ({
    page,
  }) => {
    // The Trip page mounts the same drawer off the same global selection. Here
    // the link click is itself an outside click that closes the drawer; the
    // Services module's unmount cleanup (unit-tested in ActivitiesModule.test)
    // covers exits that are not clicks, such as browser Back.
    await page.locator('[data-target="activity-card"]').click()
    await expect(page.locator('[data-target="shipment-detail"]')).toHaveAttribute(
      'data-open',
      'true',
    )

    await page.locator('[data-target="activity-trip-link"]').click()

    await expect(page).toHaveURL(new RegExp(`/driver-planning/trips/${TRIP_ID}$`))
    await expect(page.locator('[data-target="shipment-detail"][data-open="true"]')).toHaveCount(0)
  })
})
