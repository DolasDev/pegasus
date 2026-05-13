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
    // gateOnOnpremHealth navigated to /driver-planning. Best-effort wait for
    // AppGuard + the driver-planning fetch to settle so the `rowCount`-based
    // `test.skip`s below don't race the (slow) on-prem load and silently skip;
    // if the load is pathologically slow each test still has its own timeout
    // (and the @smoke test below will surface it as a real failure).
    const av = new AvailabilityPage(page)
    await av.table
      .or(page.getByText('No drivers found'))
      .waitFor({ state: 'visible', timeout: 30_000 })
      .catch(() => {})
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
    // Fails (rather than skips) when empty — the QA planning DB not being loaded
    // with driver-planning data is a real finding, not a test problem.
    await expect(av.table, 'QA planning DB should have ≥1 driver row').toBeVisible({
      timeout: 15_000,
    })
    for (const col of [
      'Driver',
      'Current Trip',
      'Est. Available Date',
      'Est. Available Location',
      'Confirmed Date',
      'Confirmed Location',
      'Notes',
    ]) {
      await expect(page.getByRole('columnheader', { name: col })).toBeVisible()
    }
    expect(await av.rowCount()).toBeGreaterThan(0)
  })

  test('current-trip cell shows a badge for assigned drivers, "None" otherwise', async ({
    page,
  }) => {
    const av = new AvailabilityPage(page)
    test.skip((await av.rowCount()) < 1, 'no drivers in the QA DB')
    const cell = av.rows.first().getByTestId('driver-current-trip')
    // Either a "#<id>" badge or the literal "None" — both are valid renders.
    await expect(cell).toContainText(/#\d+|None/)
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

  test('inline-edits a driver confirmed date/location/notes and persists @qa-mutating', async ({
    page,
  }) => {
    const av = new AvailabilityPage(page)
    test.skip((await av.rowCount()) < 1, 'no drivers in the QA DB')

    const driverId = await av.firstDriverId()
    const row = av.rowByDriverId(driverId)

    const today = new Date()
    const date = today.toISOString().slice(0, 10)
    const location = `E2E City, ${String.fromCharCode(65 + (today.getDate() % 26))}A`
    const notes = `e2e-${Date.now()}`

    await av.startEdit(row)
    await av.setConfirmed(row, { date, location, notes })
    await av.saveEdit(row)

    // Optimistic update reflected in the row…
    await expect(row).toContainText(location)
    await expect(row).toContainText(notes)

    // …and persisted: reload and re-read the row.
    await page.reload({ waitUntil: 'domcontentloaded' })
    const reloaded = av.rowByDriverId(driverId)
    await expect(reloaded).toBeVisible()
    await expect(reloaded).toContainText(location)
    await expect(reloaded).toContainText(notes)
  })

  test('cancel discards an in-progress edit @qa-mutating', async ({ page }) => {
    const av = new AvailabilityPage(page)
    test.skip((await av.rowCount()) < 1, 'no drivers in the QA DB')

    const row = av.rows.first()
    const before = (await row.innerText()).trim()
    await av.startEdit(row)
    await av.setConfirmed(row, { notes: 'should-not-be-saved' })
    await av.cancelEdit(row)
    await expect(row).not.toContainText('should-not-be-saved')
    expect((await row.innerText()).trim()).toBe(before)
  })
})
