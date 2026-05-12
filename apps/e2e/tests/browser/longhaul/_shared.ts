import type { Page } from '@playwright/test'
import { qaTest, expect } from '../../../fixtures/qa'
import { DriverPlanningLayout } from './pages/DriverPlanningLayout'

export { qaTest as test, expect }

/**
 * Navigates to /driver-planning, waits for the on-prem version-ping banner to
 * resolve, and `test.skip()`s the suite if the tunnel/Dolios/MSSQL path is down
 * — surfacing the on-prem error so the run output explains *why*. Returns the
 * layout PO once the canary is green.
 *
 * Detection is by the banner's *text* ("On-prem ping OK" / "On-prem ping
 * failed"), not its `data-testid` — so this works against the currently
 * deployed QA build as well as builds that include the `data-testid`/`data-status`
 * hooks added to `driver-planning.index.tsx` (those are only needed for the
 * finer-grained selectors elsewhere in the suite).
 *
 * Call from a `test.beforeEach`. Subsequent `await layout.goto(...)` navigations
 * are cheap (the SPA stays mounted between same-origin navigations).
 */
export async function gateOnOnpremHealth(
  page: Page,
  webUrl: string,
): Promise<DriverPlanningLayout> {
  const layout = new DriverPlanningLayout(page, webUrl)
  await layout.goto()

  const okBanner = page.getByText('On-prem ping OK', { exact: false })
  const failBanner = page.getByText('On-prem ping failed', { exact: false })
  // The banner is "Pinging on-prem API…" until the request settles — wait for
  // either terminal state. Keep this well under the 30s test timeout so a real
  // failure surfaces as a skip rather than a timeout.
  await expect(okBanner.or(failBanner)).toBeVisible({ timeout: 20_000 })

  if (await failBanner.isVisible()) {
    const detail = await failBanner
      .locator('xpath=..')
      .innerText()
      .catch(() => '')
    qaTest.skip(
      true,
      `On-prem ping not OK. The QA tunnel → Dolios → MSSQL path must be up for the longhaul ` +
        `suite. Banner said:\n${detail.trim() || '(no detail)'}`,
    )
  }
  return layout
}
