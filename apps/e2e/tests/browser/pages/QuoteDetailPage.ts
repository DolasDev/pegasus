import type { Page, Locator } from '@playwright/test'

// ---------------------------------------------------------------------------
// QuoteDetailPage — /quotes/:quoteId (tenant-web).
// Source: apps/tenant-web/src/routes/quotes.$quoteId.tsx
//
// Renders a Summary card (move id, total, valid-until) and a Line Items table
// whose last column is COMPUTED client-side as `quantity * unitPrice.amount`
// — the "line-item math" this page object exists to let specs assert.
// Quote creation has no UI yet — specs create the move + quote through the
// API (`apiFetch` fixture) and assert the detail page renders the math.
// ---------------------------------------------------------------------------

export class QuoteDetailPage {
  constructor(
    readonly page: Page,
    readonly webUrl: string,
  ) {}

  async goto(quoteId: string): Promise<void> {
    await this.page.goto(`${this.webUrl}/quotes/${quoteId}`)
  }

  /** The Summary card (shows `Total: <currency> <amount>`). */
  get summaryCard(): Locator {
    return this.page.locator('div').filter({ has: this.page.getByText('Summary', { exact: true }) })
  }

  /** Data rows of the Line Items table (excludes the header row). */
  get lineItemRows(): Locator {
    return this.page.getByRole('row').filter({ hasNot: this.page.getByRole('columnheader') })
  }

  lineItemRow(description: string): Locator {
    return this.lineItemRows.filter({ hasText: description })
  }

  /** Formats money the way the page does: `USD 376.50`. */
  static money(currency: string, amount: number): string {
    return `${currency} ${amount.toFixed(2)}`
  }
}
