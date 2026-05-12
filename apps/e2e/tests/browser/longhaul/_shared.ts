import type { Page } from '@playwright/test'
import { qaTest, expect } from '../../../fixtures/qa'
import { DriverPlanningLayout } from './pages/DriverPlanningLayout'

export { qaTest as test, expect }

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

const ONPREM_VERSION = '/api/v1/onprem/longhaul/version'

/**
 * Canary + navigation for the longhaul browser specs. Probes the on-prem
 * `/version` endpoint directly (cloud → WireGuard → Dolios → MSSQL — cheap and
 * deterministic, unlike waiting for React Query + the UI banner, which the slow
 * on-prem side makes flaky), `test.skip()`s the whole spec when it's unhealthy,
 * then navigates to `/driver-planning` and confirms the shell mounted (i.e. the
 * captured session was injected). Returns the layout PO.
 *
 * Call from a `test.beforeEach`, passing the spec's `qaApiFetch` fixture.
 */
export async function gateOnOnpremHealth(
  page: Page,
  webUrl: string,
  qaApiFetch: ApiFetch,
): Promise<DriverPlanningLayout> {
  let status: number
  try {
    status = (await qaApiFetch(ONPREM_VERSION)).status
  } catch {
    status = 0
  }
  qaTest.skip(
    status !== 200,
    `On-prem /version returned ${status || 'a network error'} — the QA tunnel → Dolios → MSSQL ` +
      `path must be up for the longhaul UI suite.`,
  )

  const layout = new DriverPlanningLayout(page, webUrl)
  await layout.goto()
  // The /driver-planning shell rendered → session injection worked, auth guard passed.
  await expect(layout.tab('Availability')).toBeVisible({ timeout: 15_000 })
  return layout
}
