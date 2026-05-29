import type { Page, Locator } from '@playwright/test'

// ---------------------------------------------------------------------------
// DriverPlanningLayout — the /driver-planning shell: the four-tab nav
// (Availability / Planning / Trips / Shipments). See:
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
}
