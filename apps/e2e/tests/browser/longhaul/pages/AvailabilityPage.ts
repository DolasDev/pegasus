import type { Page, Locator } from '@playwright/test'
import { expect } from '../../../../fixtures/qa'

// ---------------------------------------------------------------------------
// AvailabilityPage — /driver-planning (the layout index).
// Source: apps/tenant-web/src/routes/driver-planning.index.tsx
//
// Mirrors the legacy "driver availability / planning overview" surface: a table
// of drivers (current trip, ready date/location) with click-to-edit "ready"
// date / location / notes that round-trip to the on-prem MSSQL DB via
// PATCH /api/v1/longhaul/driver-planning/:driverId.
//
// Editing model: one field at a time. Clicking a cell swaps it for an input;
// blur or Enter commits (fires the PATCH), Escape reverts. There is no Edit
// button and no save/cancel buttons.
// ---------------------------------------------------------------------------

export class AvailabilityPage {
  constructor(readonly page: Page) {}

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

  private static readonly CELL_TESTID: Record<'date' | 'location' | 'notes', string> = {
    date: 'ready-date-cell',
    location: 'ready-location-cell',
    notes: 'notes-cell',
  }

  /**
   * Click a field's cell, type `value`, then either commit (Enter) or revert
   * (Escape). The input is gone afterwards in both cases.
   */
  async editField(
    row: Locator,
    field: 'date' | 'location' | 'notes',
    value: string,
    commit: 'enter' | 'escape' = 'enter',
  ): Promise<void> {
    await row.getByTestId(AvailabilityPage.CELL_TESTID[field]).click()
    const input = row.getByTestId(`confirmed-${field}-input`)
    await expect(input).toBeVisible()
    await input.fill(value)
    await input.press(commit === 'enter' ? 'Enter' : 'Escape')
    await expect(input).toBeHidden()
  }

  /** Set any provided ready fields, committing each (one PATCH per field). */
  async setConfirmed(
    row: Locator,
    values: { date?: string; location?: string; notes?: string },
  ): Promise<void> {
    if (values.date !== undefined) await this.editField(row, 'date', values.date)
    if (values.location !== undefined) await this.editField(row, 'location', values.location)
    if (values.notes !== undefined) await this.editField(row, 'notes', values.notes)
  }
}
