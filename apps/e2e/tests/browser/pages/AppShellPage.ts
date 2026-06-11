import type { Page, Locator } from '@playwright/test'

// ---------------------------------------------------------------------------
// AppShellPage — the authenticated tenant-web chrome (sidebar + header).
// Source: apps/tenant-web/src/components/AppShell.tsx
//         apps/tenant-web/src/routes/__root.tsx
//
// The sidebar nav renders only after GET /api/v1/me/permissions resolves
// (AppShell hides every item while `perms.isLoading`), so asserting a nav
// link visible doubles as an end-to-end check of the SPA → API auth path.
//
// Under the e2e auth seam (tenant-web built with `vite build --mode e2e` —
// see apps/tenant-web/src/auth/session.ts) the session is a synthetic
// tenant_admin, so every main-nav item is expected to render.
//
// VARIANT NOTE: none of the shell/customers/quotes surfaces randomize view
// variants (only /driver-planning does — see longhaul/pages/AvailabilityPage),
// so no variant pinning is needed here.
// ---------------------------------------------------------------------------

/** Main-nav labels a tenant_admin should always see, in render order. */
export const ADMIN_NAV_LABELS = [
  'Dashboard',
  'Moves',
  'Quotes',
  'Customers',
  'Dispatch',
  'Billing',
  'Operations',
] as const

export class AppShellPage {
  constructor(
    readonly page: Page,
    readonly webUrl: string,
  ) {}

  async gotoDashboard(): Promise<void> {
    await this.page.goto(`${this.webUrl}/dashboard`)
  }

  get sidebar(): Locator {
    return this.page.locator('aside')
  }

  /** A main-nav (or settings-nav) link by its visible label. */
  navLink(label: string): Locator {
    return this.sidebar.getByRole('link', { name: label, exact: true })
  }

  /** Header area showing tenant name + signed-in email. */
  get header(): Locator {
    return this.page.locator('header')
  }
}
