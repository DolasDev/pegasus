import type { Page, Locator } from '@playwright/test'
import { expect } from '../../../../fixtures/qa'

// ---------------------------------------------------------------------------
// AvailabilityPage — /driver-planning (the layout index).
// Source: apps/tenant-web/src/routes/driver-planning.index.tsx
//
// Mirrors the legacy "driver availability / planning overview" surface: a table
// of drivers (current trip, estimated availability) with inline-editable
// "confirmed" date / location / notes that round-trip to the on-prem MSSQL DB
// via PATCH /api/v1/longhaul/driver-planning/:driverId.
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

  // -- inline edit (within a given row) -------------------------------------

  async startEdit(row: Locator): Promise<void> {
    // Either the dedicated "Edit" button or clicking the confirmed-date cell
    // toggles the row into edit mode.
    const editBtn = row.getByTestId('confirmed-edit')
    if (await editBtn.isVisible().catch(() => false)) {
      await editBtn.click()
    } else {
      await row.getByTestId('confirmed-date-cell').click()
    }
    await expect(row.getByTestId('confirmed-date-input')).toBeVisible()
  }

  async setConfirmed(
    row: Locator,
    values: { date?: string; location?: string; notes?: string },
  ): Promise<void> {
    if (values.date !== undefined) await row.getByTestId('confirmed-date-input').fill(values.date)
    if (values.location !== undefined)
      await row.getByTestId('confirmed-location-input').fill(values.location)
    if (values.notes !== undefined)
      await row.getByTestId('confirmed-notes-input').fill(values.notes)
  }

  async saveEdit(row: Locator): Promise<void> {
    await row.getByTestId('confirmed-save').click()
    await expect(row.getByTestId('confirmed-date-input')).toBeHidden()
  }

  async cancelEdit(row: Locator): Promise<void> {
    await row.getByTestId('confirmed-cancel').click()
    await expect(row.getByTestId('confirmed-date-input')).toBeHidden()
  }
}
