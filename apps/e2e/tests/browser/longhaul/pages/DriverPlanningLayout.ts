import type { Page, Locator } from '@playwright/test'
import { expect } from '../../../../fixtures/qa'

// ---------------------------------------------------------------------------
// DriverPlanningLayout — the /driver-planning shell: the four-tab nav
// (Availability / Planning / Trips / Shipments) plus the on-prem version-ping
// banner that the layout's index renders. See:
//   apps/tenant-web/src/features/driver-planning/DriverPlanningLayout.tsx
//   apps/tenant-web/src/routes/driver-planning.index.tsx
// ---------------------------------------------------------------------------

export type DpTab = 'Availability' | 'Planning' | 'Trips' | 'Shipments'

export class DriverPlanningLayout {
  constructor(
    readonly page: Page,
    /** Web app base URL (no trailing slash). */
    readonly webUrl: string,
  ) {}

  /** The on-prem version-ping banner (`data-testid="onprem-ping"`, `data-status`). */
  get onpremPing(): Locator {
    return this.page.getByTestId('onprem-ping')
  }

  tab(name: DpTab): Locator {
    return this.page.getByRole('link', { name, exact: true })
  }

  async goto(path: '' | '/planning' | '/trips' | '/shipments' = ''): Promise<void> {
    await this.page.goto(`${this.webUrl}/driver-planning${path}`, {
      waitUntil: 'domcontentloaded',
    })
  }

  async openTab(name: DpTab): Promise<void> {
    await this.tab(name).click()
  }

  /**
   * Asserts the on-prem tunnel→Dolios→MSSQL path is healthy. The whole QA
   * browser suite gates on this; specs call `ensureOnpremHealthy()` (which
   * `test.skip()`s with the surfaced error) rather than letting every spec
   * fail opaquely when the tunnel is down.
   */
  async expectOnpremHealthy(): Promise<void> {
    await expect(this.onpremPing).toHaveAttribute('data-status', /loading|ok|error/, {
      timeout: 30_000,
    })
    await expect
      .poll(async () => this.onpremPing.getAttribute('data-status'), { timeout: 30_000 })
      .not.toBe('loading')
    await expect(this.onpremPing).toHaveAttribute('data-status', 'ok')
  }

  /** Returns the on-prem error text when the banner is in the `error` state, else null. */
  async onpremErrorText(): Promise<string | null> {
    if ((await this.onpremPing.getAttribute('data-status')) !== 'error') return null
    return (await this.onpremPing.innerText()).trim()
  }
}
