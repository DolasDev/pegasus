import type { Page, Locator } from '@playwright/test'
import { expect } from '../../../../fixtures/qa'

// ---------------------------------------------------------------------------
// AvailabilityPage — /driver-planning (the layout index).
// Source: apps/tenant-web/src/routes/driver-planning.index.tsx
//         apps/tenant-web/src/features/driver-planning/availability/AvailabilityViewC.tsx
//
// Mirrors the legacy "driver availability / planning overview" surface: a table
// of drivers (current trip, ready date/state/city) with click-to-edit "ready"
// fields that round-trip to the on-prem MSSQL DB via
// PATCH /api/v1/longhaul/driver-planning/:driverId.
//
// VARIANT NOTE: the index route picks one of three view variants (A/B/C) at
// RANDOM per mount (pickRandomVariant). This PO targets variant C — the only one
// that keeps the driver-table columns, the current-trip cell, and inline ready
// editing. Specs MUST call `pinVariant('C')` (in beforeEach and after any reload)
// before asserting.
//
// Editing model (variant C): Ready Date / Ready State / Ready City are LINKED —
// clicking any of the three opens all three inputs at once, and the PATCH only
// fires once all three are filled (`setReady`). Notes edits independently
// (`editNotes`). Blur or Enter commits; Escape reverts. No save/cancel buttons.
// ---------------------------------------------------------------------------

export class AvailabilityPage {
  constructor(readonly page: Page) {}

  /**
   * Pin the Availability view to a specific A/B/C variant. The index route picks
   * one at random per mount (driver-planning.index.tsx: pickRandomVariant), so
   * the specs pin variant C before asserting — and again after any page reload,
   * which re-randomises the pick.
   */
  async pinVariant(key: 'A' | 'B' | 'C' = 'C'): Promise<void> {
    const tab = this.page.getByTestId(`availability-view-tab-${key}`)
    await tab.waitFor({ state: 'visible', timeout: 15_000 })
    await tab.click()
    // Radix TabsTrigger marks the active tab; confirm the switch took before the
    // caller waits on variant-C-specific DOM.
    await expect(tab).toHaveAttribute('data-state', 'active')
  }

  get table(): Locator {
    return this.page.getByTestId('driver-table')
  }
  get filterInput(): Locator {
    return this.page.getByTestId('driver-filter')
  }
  get rows(): Locator {
    return this.page.getByTestId('driver-row')
  }

  rowByDriverId(driverId: string | number): Locator {
    return this.page.locator(`[data-testid="driver-row"][data-driver-id="${driverId}"]`)
  }
  rowByName(name: string): Locator {
    return this.rows.filter({ hasText: name })
  }

  async filterBy(text: string): Promise<void> {
    await this.filterInput.fill(text)
  }

  async rowCount(): Promise<number> {
    return this.rows.count()
  }

  /** First driver row's `data-driver-id` — useful as a fixture id for mutations. */
  async firstDriverId(): Promise<string> {
    await expect(this.rows.first()).toBeVisible()
    const id = await this.rows.first().getAttribute('data-driver-id')
    if (!id) throw new Error('first driver row has no data-driver-id')
    return id
  }

  // -- click-to-edit (within a given row) -----------------------------------

  /**
   * Set the linked Ready Date / State / City for a row. Clicking the date cell
   * opens all three inputs; the variant-C commit (`commitLinked`) is a no-op
   * until every one is filled, so we populate date → state → city and commit the
   * whole set with one Enter, firing a single PATCH. The inputs disappear once
   * the mutation resolves (give the on-prem round-trip some headroom).
   */
  async setReady(
    row: Locator,
    values: { date: string; state: string; city: string },
  ): Promise<void> {
    await row.getByTestId('ready-date-cell').click()
    const dateInput = row.getByTestId('confirmed-date-input')
    await expect(dateInput).toBeVisible()
    await dateInput.fill(values.date)
    await row.getByTestId('confirmed-state-input').fill(values.state)
    const cityInput = row.getByTestId('confirmed-city-input')
    await cityInput.fill(values.city)
    await cityInput.press('Enter')
    await expect(dateInput).toBeHidden({ timeout: 15_000 })
  }

  /**
   * Edit the (independent) Notes field. Click the cell, type `value`, then
   * commit (Enter) or revert (Escape). The input is gone afterwards either way.
   */
  async editNotes(
    row: Locator,
    value: string,
    commit: 'enter' | 'escape' = 'enter',
  ): Promise<void> {
    await row.getByTestId('notes-cell').click()
    const input = row.getByTestId('confirmed-notes-input')
    await expect(input).toBeVisible()
    await input.fill(value)
    await input.press(commit === 'enter' ? 'Enter' : 'Escape')
    await expect(input).toBeHidden({ timeout: 15_000 })
  }
}
