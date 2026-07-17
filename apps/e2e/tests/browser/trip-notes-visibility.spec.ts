import { test, expect, type Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Trip-detail Notes panel — deterministic visibility regression guard.
//
// The Notes widget (`.noteContainer`, `[data-target="trip-notes"]`) is
// `position: absolute; right: 10px`, so it pins to the right edge of its
// offset parent — the Lane `.container`, whose width comes from
// `.tripContainer`. The ported longhaul value `width: calc(100vw - 90px)`
// (standalone app: viewport minus a 90px rail) is WIDER than tenant-web's
// AppShell content column, so the Lane overflowed to the right. That was
// harmless until `.driver-planning-root { overflow-x: clip }` was added (to
// hide the off-screen ShipmentDetail slide) — the clip then chopped the
// over-wide right edge and took the right-pinned Notes panel off-screen.
//
// This spec locks the invariant that regressed: the Notes panel's right edge
// must stay within `.driver-planning-root`'s (clipped) content box, and
// `.tripContainer` must not be wider than that box. Unlike its sibling
// `trip-date-container` spec this is geometry-only (no screenshot baseline), so
// it is machine-independent and runs in PR CI's served-e2e browser lane rather
// than being E2E_VISUAL manual-only.
//
// DETERMINISTIC BY DESIGN: every /driver-planning/* network call is stubbed via
// page.route, mirroring trip-date-container.spec.ts. Tagged `@local-only` — it
// needs the SKIP_AUTH e2e-mode tenant-web build served at WEB_URL (remote/qa
// gates exclude it via grepInvert).
// ---------------------------------------------------------------------------

const WEB_URL = process.env['WEB_URL']
const TRIP_ID = 4343

test.skip(!WEB_URL, 'WEB_URL not set — needs a served e2e-mode tenant-web build')

const tripFixture = {
  id: TRIP_ID,
  trip_title: 'Notes-Visibility',
  driver_name: 'Big Rig',
  driver: { driver_name: 'Big Rig' },
  planner: { first_name: 'PA', last_name: 'PB' },
  dispatcher: { first_name: 'DA', last_name: 'DB' },
  total_estimated_lbs: 1000,
  total_actual_lbs: 1100,
  total_estimated_linehaul_usd: 5000,
  status: { status: 'Pending' },
  // A note so the widget renders its "Notes (1)" title + Add-Note affordance.
  notes: [
    {
      id: 'n1',
      note: 'CALL SHIPPER BEFORE ARRIVAL — gate code 4343.',
      createdByUser: { first_name: 'Dispatch', last_name: 'Desk', email_address: 'd@x.com' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ],
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
        supervip: 'N',
        total_est_wt: 5000,
        pegasus_shadow: null,
      },
    },
  ],
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

    if (/^\/trips\/\d+$/.test(path)) return json(tripFixture)
    if (/^\/trips\/\d+\/summary$/.test(path)) return json({})
    if (path === '/users/me') return json({ windows_user: 'e2e', driver_name: 'E2E' })
    if (path === '/version') return json({ version: 'e2e' })
    return json([])
  })
}

test.describe('Trip Notes panel stays on-screen @local-only', () => {
  test.beforeEach(async ({ page }) => {
    await stubLonghaul(page)
    await page.goto(`${WEB_URL}/driver-planning/trips/${TRIP_ID}`, {
      waitUntil: 'domcontentloaded',
    })
    await expect(page.locator('[data-target="trip-notes"]')).toBeVisible({ timeout: 30_000 })
  })

  test('Notes panel is within the clipped driver-planning root, not off-screen right', async ({
    page,
  }) => {
    const geom = await page.evaluate(() => {
      const root = document.querySelector('.driver-planning-root') as HTMLElement | null
      const trip = document.querySelector('[class*="tripContainer"]') as HTMLElement | null
      const note = document.querySelector('[class*="noteContainer"]') as HTMLElement | null
      if (!root || !trip || !note) return null
      const r = root.getBoundingClientRect()
      const t = trip.getBoundingClientRect()
      const n = note.getBoundingClientRect()
      return {
        rootRight: r.right,
        rootWidth: r.width,
        tripWidth: t.width,
        noteRight: n.right,
        noteWidth: n.width,
      }
    })

    expect(geom, 'root/tripContainer/noteContainer must all be present').not.toBeNull()
    const g = geom!

    // The regression: `.tripContainer` was `calc(100vw - 90px)`, wider than the
    // content column, which pushed the right-pinned notes past the clip edge.
    expect(
      g.tripWidth,
      '.tripContainer must not exceed the driver-planning root',
    ).toBeLessThanOrEqual(g.rootWidth + 1)

    // The user-visible symptom: the notes panel's right edge sat beyond the
    // `overflow-x: clip` boundary (the root's content box) and was chopped off.
    expect(
      g.noteRight,
      'Notes panel right edge must stay within the clipped driver-planning root',
    ).toBeLessThanOrEqual(g.rootRight + 1)

    // Sanity: the panel actually has its intended width (not collapsed to 0).
    expect(g.noteWidth).toBeGreaterThan(100)
  })
})
