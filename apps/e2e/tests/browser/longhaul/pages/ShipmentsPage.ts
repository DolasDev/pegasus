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

  /** The `data-id` (order number) of every currently-rendered table row. */
  async rowOrderNums(): Promise<string[]> {
    return (
      await this.rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''))
    ).filter(Boolean)
  }

  /**
   * Add an option to a FilterTabs react-select filter row (e.g. property
   * "assigned", label "Yes"): click the row's input to open the menu, type the
   * label, press Enter to pick the highlighted option. Returns once the chip
   * (`.rs__multi-value__label`, from the `classNamePrefix="rs"` on `Select`) is
   * visible.
   */
  async addSelectFilterOption(property: string, label: string): Promise<void> {
    const row = this.filterRow(property)
    const input = row.locator('input').first()
    await input.click()
    await input.fill(label)
    await input.press('Enter')
    await row
      .locator('.rs__multi-value__label', { hasText: label })
      .first()
      .waitFor({ state: 'visible' })
  }

  /** The selected react-select chip labels on a FilterTabs filter row. */
  async selectFilterChips(property: string): Promise<string[]> {
    return (
      await this.filterRow(property)
        .locator('.rs__multi-value__label')
        .evaluateAll((els) => els.map((e) => e.textContent ?? ''))
    ).map((s) => s.trim())
  }
}
