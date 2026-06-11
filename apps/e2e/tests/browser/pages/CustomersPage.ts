import type { Page, Locator } from '@playwright/test'

// ---------------------------------------------------------------------------
// CustomersPage — /customers (tenant-web).
// Source: apps/tenant-web/src/routes/customers.index.tsx
//         apps/tenant-web/src/components/DataTable.tsx
//
// A read-only DataTable of customers (ID / First Name / Last Name / Email /
// Phone) with a client-side last-name filter. Customer creation has no UI
// yet — specs create records through POST /api/v1/customers (the `apiFetch`
// fixture) and assert the list renders them.
// ---------------------------------------------------------------------------

export class CustomersPage {
  constructor(
    readonly page: Page,
    readonly webUrl: string,
  ) {}

  async goto(): Promise<void> {
    await this.page.goto(`${this.webUrl}/customers`)
  }

  /** DataTable's client-side filter input (keyed on lastName). */
  get filterInput(): Locator {
    return this.page.getByPlaceholder('Filter by last name…')
  }

  async filterByLastName(lastName: string): Promise<void> {
    await this.filterInput.fill(lastName)
  }

  /** Data rows of the customers table (excludes the header row). */
  get rows(): Locator {
    return this.page.getByRole('row').filter({ hasNot: this.page.getByRole('columnheader') })
  }

  rowByText(text: string): Locator {
    return this.rows.filter({ hasText: text })
  }
}
