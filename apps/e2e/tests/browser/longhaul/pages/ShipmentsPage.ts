import type { Page, Locator } from '@playwright/test'

// ---------------------------------------------------------------------------
// ShipmentsPage — /driver-planning/shipments
// Source: apps/tenant-web/src/features/driver-planning/routes/ShipmentModule.tsx
//   → <h1>Shipments Module</h1>, <Lane title="Shipments">, <FilterTabs/>,
//     <ShipmentsTable/> (columns: Shipper, Origin City, O St, D City, D St,
//     Est Wt, Pack/Load/Del Range).
//
// The legacy `Shipments` search dashboard (the left pane of /planning) uses the
// same `FilterTabs` plus sortable headers: Origin, Destination, Weight, Pack
// Date, Load Date, Del Date, Mode, Account, Driver — see
//   apps/tenant-web/src/features/driver-planning/containers/Shipments/index.tsx
//
// NOTE: these locators are derived from source, not yet from the running QA app.
// Phase A (exploratory browse) should confirm them and add data-testids to the
// ported components where role/text proves brittle.
// ---------------------------------------------------------------------------

export class ShipmentsPage {
  constructor(readonly page: Page) {}

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'Shipments Module' })
  }
  get lane(): Locator {
    // Lane component renders its `title` ("Shipments") — count is in the search
    // dashboard variant ("Shipments (n)"), not this module.
    return this.page.getByText('Shipments', { exact: true })
  }
  get table(): Locator {
    return this.page.locator('table')
  }
  get rows(): Locator {
    return this.table.locator('tbody tr')
  }

  /** A sortable column header in the legacy search dashboard / table. */
  columnHeader(label: string): Locator {
    return this.page.getByText(label, { exact: true })
  }

  async rowCount(): Promise<number> {
    return this.rows.count()
  }

  async sortBy(label: string): Promise<void> {
    await this.columnHeader(label).click()
  }
}
