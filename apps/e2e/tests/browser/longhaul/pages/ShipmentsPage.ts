import type { Page, Locator } from '@playwright/test'

// ---------------------------------------------------------------------------
// ShipmentsPage — /driver-planning/shipments
// Source: apps/tenant-web/src/features/driver-planning/routes/ShipmentModule.tsx
//   → <h1>Shipments Module</h1>, <Lane title="Shipments">, <FilterTabs/>,
//     <ShipmentsTable/> (one <tr data-target="shipment-table-row">/row).
//
// Selectors use the `data-target` hooks added to the ported FilterTabs /
// Table / ShipmentCard components.
// ---------------------------------------------------------------------------

export class ShipmentsPage {
  constructor(readonly page: Page) {}

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'Shipments Module' })
  }
  get table(): Locator {
    return this.page.locator('table')
  }
  get rows(): Locator {
    return this.page.locator('[data-target="shipment-table-row"]')
  }
  rowByOrderNum(orderNum: string | number): Locator {
    return this.page.locator(`[data-target="shipment-table-row"][data-id="${orderNum}"]`)
  }

  // -- FilterTabs -----------------------------------------------------------
  get searchInput(): Locator {
    return this.page.locator('[data-target="shipment-search"]')
  }
  get toggleFilters(): Locator {
    return this.page.locator('[data-target="toggle-filters"]')
  }
  get clearFilters(): Locator {
    return this.page.locator('[data-target="clear-filters"]')
  }
  get saveFilterLink(): Locator {
    return this.page.locator('[data-target="save-filter"]')
  }
  get openFiltersModal(): Locator {
    return this.page.locator('[data-target="open-filters-modal"]')
  }
  get filtersBody(): Locator {
    return this.page.locator('[data-target="filters-body"]')
  }
  /** A filter row by its `data-filter` property name (e.g. "assigned", "origin"). */
  filterRow(property: string): Locator {
    return this.page.locator(`[data-target="filter-row"][data-filter="${property}"]`)
  }

  // -- sort headers (search-dashboard variant) ------------------------------
  /** A sortable column header by its sort key (e.g. "total_est_wt"). */
  sortHeader(sortKey: string): Locator {
    return this.page.locator(`[data-target="shipment-sort-header"][data-sort="${sortKey}"]`)
  }

  async rowCount(): Promise<number> {
    return this.rows.count()
  }
}
