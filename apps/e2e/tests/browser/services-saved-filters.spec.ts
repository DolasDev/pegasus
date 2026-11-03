import { test, expect, type Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Services board saved filters (the Availability pattern, on /services-filters).
//
//   1. A saved default is the board's FIRST query. The board must not fetch
//      the built-in week and then re-fetch the saved range.
//   2. Save Filter posts the board's current query, with dates as day offsets.
//
// DETERMINISTIC BY DESIGN: every API call is stubbed via page.route, mirroring
// services-shipment-detail.spec.ts. Tagged `@local-only`: it needs the
// SKIP_AUTH e2e-mode tenant-web build served at WEB_URL.
// ---------------------------------------------------------------------------

const WEB_URL = process.env['WEB_URL']

test.skip(!WEB_URL, 'WEB_URL not set — needs a served e2e-mode tenant-web build')

/** Local `YYYY-MM-DD`, `offset` days from today — the board's date format. */
function isoInDays(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

const activityRow = {
  id: 1,
  order_num: 80808,
  TripMaster_id: null,
  ActivityType_code: 'DEL',
  scheduled_date: '2026-10-21T00:00:00.000Z',
  status: 'Scheduled',
  city: 'DALLAS',
  state: 'TX',
  activity_type_abbreviation: 'DL',
  shipper_name: 'SAVED, FILTER',
}

const savedDefault = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Two-week deliveries',
  query: {
    v: 1,
    dateFromOffsetDays: 2,
    dateToOffsetDays: 16,
    activityTypes: ['DL'],
    shortHaul: ['N'],
    dispatchers: [],
    sortBy: { value: 'order_num', order: 'desc' },
  },
  isPublic: false,
  isDefault: true,
  owner: { id: 'u1', email: 'e2e@example.test' },
  createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
}

type Option = { label: string; value: string }

/** The board's `/activities?filters=` payload (buildActivityRequest). */
interface ActivityRequest {
  filters: { date_range: [string, string]; activity_type: Option[]; short_haul: Option[] }
  sortBy: { value: string; order: string } | null
}

/** Stubs the API; returns every `filters` query the board sent to /activities. */
async function stub(page: Page, defaultFilter: unknown): Promise<ActivityRequest[]> {
  const activityQueries: ActivityRequest[] = []
  await page.route('**/api/v1/onprem/longhaul/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.split('/api/v1/onprem/longhaul')[1] ?? ''
    const json = (data: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data }),
      })

    if (path === '/activities') {
      activityQueries.push(JSON.parse(url.searchParams.get('filters') ?? 'null'))
      return json([activityRow])
    }
    if (path === '/users/me') return json({ windows_user: 'e2e', driver_name: 'E2E' })
    if (path === '/version') return json({ version: 'e2e' })
    return json([])
  })
  await page.route('**/api/v1/services-filters/default', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: defaultFilter }),
    }),
  )
  return activityQueries
}

test.describe('Services board saved filters @local-only', () => {
  test('opens on the saved default, and it is the first query sent', async ({ page }) => {
    const queries = await stub(page, savedDefault)

    await page.goto(`${WEB_URL}/driver-planning/activities`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-target="activity-card"]')).toBeVisible({ timeout: 30_000 })

    await expect(page.getByTestId('activities-filter-date-from')).toHaveValue(isoInDays(2))
    await expect(page.getByTestId('activities-filter-date-to')).toHaveValue(isoInDays(16))
    await expect(page.getByTestId('activities-filter-type')).toContainText('DL')

    // Past the 1s debounce: anything queued would have gone out by now.
    await page.waitForTimeout(1500)
    expect(queries.length, 'the board should have queried').toBeGreaterThan(0)
    for (const q of queries) {
      expect(q.filters.date_range).toEqual([isoInDays(2), isoInDays(16)])
    }
    const first = queries[0]!
    expect(first.filters.activity_type).toEqual([{ label: 'DL', value: 'DL' }])
    expect(first.filters.short_haul).toEqual([{ label: 'No', value: 'N' }])
    expect(first.sortBy).toEqual({ value: 'order_num', order: 'desc' })
  })

  test('Save Filter posts the board query with dates as offsets', async ({ page }) => {
    await stub(page, null)
    let posted: { name: string } | null = null
    await page.route('**/api/v1/services-filters', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      const body = route.request().postDataJSON() as { name: string }
      posted = body
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ data: { ...savedDefault, name: body.name } }),
      })
    })

    await page.goto(`${WEB_URL}/driver-planning/activities`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-target="activity-card"]')).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('save-services-filter').click()
    await page.getByTestId('services-filter-name').fill('This week')
    await page.getByTestId('services-filter-public').check()
    await page.getByTestId('services-filter-save-submit').click()
    await expect(page.getByTestId('save-services-filter-dialog')).toBeHidden()

    expect(posted).toEqual({
      name: 'This week',
      isDefault: false,
      isPublic: true,
      query: {
        v: 1,
        dateFromOffsetDays: 0,
        dateToOffsetDays: 7,
        activityTypes: [],
        shortHaul: [],
        dispatchers: [],
        offices: [],
        sortBy: null,
      },
    })
  })
})
