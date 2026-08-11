import { test, expect, gateOnOnpremHealth } from './_shared'
import { AvailabilityPage } from './pages/AvailabilityPage'

// ---------------------------------------------------------------------------
// /driver-planning (Availability tab) — driver availability + confirmed-date
// inline editing, mirroring the legacy "planning overview" surface.
// Read-only assertions are untagged; the inline-edit round-trip is @qa-mutating
// (writes to the on-prem MSSQL DB via PATCH /api/v1/longhaul/driver-planning/:id).
// ---------------------------------------------------------------------------

test.describe('Availability tab', () => {
  test.beforeEach(async ({ page, qaWebUrl, qaApiFetch }) => {
    await gateOnOnpremHealth(page, qaWebUrl, qaApiFetch)
    // gateOnOnpremHealth navigated to /driver-planning. The index route renders
    // View A by default (the random A/B/C pick was removed); pin A explicitly so
    // the specs stay robust to the tab state before waiting on the driver table.
    const av = new AvailabilityPage(page)
    await av.pinVariant('A')
    // Best-effort wait for AppGuard + the driver-planning fetch to settle so the
    // `rowCount`-based `test.skip`s below don't race the (slow) on-prem load and
    // silently skip; if the load is pathologically slow each test still has its
    // own timeout (and the @smoke test below will surface it as a real failure).
    await av.table
      .or(page.getByText('No drivers found'))
      .waitFor({ state: 'visible', timeout: 30_000 })
      .catch(() => {})
    // View A's Move Type filter defaults to "Long Dist."; these specs assert on
    // the full roster, so clear it before anything counts rows.
    await av.clearMoveTypeFilter()
  })

  test('the Availability tab renders (driver table or empty state) @smoke', async ({ page }) => {
    // Always-true smoke: the page mounted and the on-prem ping is OK (asserted
    // in beforeEach). With driver data the table renders; without it the
    // EmptyState does. The "has data" assertion is the separate test below.
    const av = new AvailabilityPage(page)
    await expect(av.table.or(page.getByText('No drivers found'))).toBeVisible({ timeout: 15_000 })
  })

  test('the known-good DB has driver rows with the expected columns', async ({ page }) => {
    const av = new AvailabilityPage(page)
    // The on-prem `GET /driver-planning` and the AppGuard bootstrap both flake
    // intermittently (empty/slow) even though the qa-api probe passes in the
    // same run — one reload-retry before treating an empty table as a real "QA
    // planning DB not loaded" finding.
    if (!(await av.table.isVisible())) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await av.pinVariant('A') // re-assert View A after the reload
      await av.table
        .or(page.getByText('No drivers found'))
        .waitFor({ state: 'visible', timeout: 30_000 })
        .catch(() => {})
      // The reload reset the Move Type filter to its "Long Dist." default.
      await av.clearMoveTypeFilter()
    }
    await expect(av.table, 'QA planning DB should have ≥1 driver row').toBeVisible({
      timeout: 15_000,
    })
    // View A splits the legacy "Ready Location" column into Ready State + Ready City
    // and folds the current-trip link into the Deliveries cell (no Current Trip
    // column). Substring (non-exact) match on purpose: the "Ready Date" header
    // carries a Font Awesome sort caret whose CSS ::before glyph leaks into the
    // accessible name, so `exact` would miss it. None of these names is a substring
    // of another, so each still resolves to exactly one columnheader.
    for (const col of [
      'Driver',
      'Ready Date',
      'Ready State',
      'Ready City',
      'Deliveries',
      'Notes',
    ]) {
      await expect(page.getByRole('columnheader', { name: col })).toBeVisible()
    }
    expect(await av.rowCount()).toBeGreaterThan(0)
  })

  test('deliveries cell links to the trip screen for assigned drivers', async ({ page }) => {
    const av = new AvailabilityPage(page)
    test.skip((await av.rowCount()) < 1, 'no drivers in the QA DB')
    // View A folds the current-trip link into the Deliveries cell: an assigned
    // driver's deliveries table is a click-through to its trip screen, while an
    // unassigned driver (or one with no shipments) renders a plain cell with no link.
    const cell = av.rows.first().getByTestId('driver-deliveries')
    const link = cell.getByTestId('deliveries-trip-link')
    if (await link.isVisible().catch(() => false)) {
      await expect(link).toHaveAttribute('href', /\/driver-planning\/trips\/\d+/)
      await expect(link).not.toContainText('#')
    } else {
      await expect(cell).toBeVisible()
    }
  })

  test('filtering by driver name narrows the rows and clears back', async ({ page }) => {
    const av = new AvailabilityPage(page)
    const total = await av.rowCount()
    test.skip(total < 1, 'no drivers in the QA DB')

    const firstName = (await av.rows.first().getByTestId('driver-name').innerText()).trim()
    const token = firstName.split(/\s+/)[0] ?? firstName
    await av.filterBy(token)
    await expect.poll(() => av.rowCount()).toBeGreaterThan(0)
    for (const row of await av.rows.all()) {
      await expect(row.getByTestId('driver-name')).toContainText(token, { ignoreCase: true })
    }

    await av.filterBy('zzz-no-such-driver-zzz')
    await expect(page.getByText('No matching drivers.')).toBeVisible()

    await av.filterBy('')
    await expect.poll(() => av.rowCount()).toBe(total)
  })

  test('inline-edits a driver confirmed ready date/state/city/notes and persists @qa-mutating', async ({
    page,
  }) => {
    const av = new AvailabilityPage(page)
    test.skip((await av.rowCount()) < 1, 'no drivers in the QA DB')

    const driverId = await av.firstDriverId()
    const row = av.rowByDriverId(driverId)

    const date = new Date().toISOString().slice(0, 10)
    const state = 'TX' // 2-letter code so it round-trips as Ready State (not City)
    const stamp = `${Date.now()}`
    const city = `E2E City ${stamp.slice(-6)}` // unique per run so the reload check is meaningful
    const notes = `e2e-${stamp}`

    // Ready Date/State/City commit together (one linked PATCH); Notes is separate.
    await av.setReady(row, { date, state, city })
    await av.editNotes(row, notes)

    // Persisted values reflected in the row…
    await expect(row).toContainText(state)
    await expect(row).toContainText(city)
    await expect(row).toContainText(notes)

    // …and persisted: reload (re-assert View A) and re-read. The reload also
    // resets Move Type to its "Long Dist." default, which would hide the edited
    // driver unless they happen to be long-distance — clear it before re-reading.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await av.pinVariant('A')
    await av.clearMoveTypeFilter()
    const reloaded = av.rowByDriverId(driverId)
    await expect(reloaded).toBeVisible()
    await expect(reloaded).toContainText(state)
    await expect(reloaded).toContainText(city)
    await expect(reloaded).toContainText(notes)
  })

  test('cancel discards an in-progress edit @qa-mutating', async ({ page }) => {
    const av = new AvailabilityPage(page)
    test.skip((await av.rowCount()) < 1, 'no drivers in the QA DB')

    const row = av.rows.first()
    const before = (await row.innerText()).trim()
    // Type into Notes then Escape — the edit must be discarded (no PATCH).
    await av.editNotes(row, 'should-not-be-saved', 'escape')
    await expect(row).not.toContainText('should-not-be-saved')
    expect((await row.innerText()).trim()).toBe(before)
  })
})
