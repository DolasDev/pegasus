import type { Page } from '@playwright/test'
import { qaTest, expect } from '../../../fixtures/qa'
import { DriverPlanningLayout } from './pages/DriverPlanningLayout'

export { qaTest as test, expect }

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

const ONPREM_BASE = '/api/v1/onprem/longhaul'
// Two probes, both on the cloud → WireGuard → Dolios → MSSQL path:
//   /version   — the tunnel + DB are alive
//   /users/me  — the X-Windows-User → Dolios-user mapping resolves (AppGuard
//                gates the whole module on this; a flaky/slow lookup leaves the
//                page stuck on "Loading…", which we'd rather skip than fail on).
const ONPREM_PROBES = [`${ONPREM_BASE}/version`, `${ONPREM_BASE}/users/me`] as const

/**
 * Canary + navigation for the longhaul browser specs. Probes the on-prem
 * `/version` and `/users/me` endpoints directly (cheap and deterministic,
 * unlike waiting for React Query + the UI banner, which the slow on-prem side
 * makes flaky), `test.skip()`s the whole spec when either is unhealthy, then
 * navigates to `/driver-planning` and confirms the shell mounted (i.e. the
 * captured session was injected). Returns the layout PO.
 *
 * Call from a `test.beforeEach`, passing the spec's `qaApiFetch` fixture.
 */
export async function gateOnOnpremHealth(
  page: Page,
  webUrl: string,
  qaApiFetch: ApiFetch,
): Promise<DriverPlanningLayout> {
  for (const path of ONPREM_PROBES) {
    let status: number
    try {
      status = (await qaApiFetch(path)).status
    } catch {
      status = 0
    }
    qaTest.skip(
      status !== 200,
      `On-prem GET ${path} returned ${status || 'a network error'} — the QA tunnel → Dolios → ` +
        `MSSQL path (and the Dolios-user mapping) must be up for the longhaul UI suite.`,
    )
  }

  const layout = new DriverPlanningLayout(page, webUrl)
  await layout.goto()
  // The /driver-planning shell rendered → session injection worked, auth guard passed.
  await expect(layout.tab('Availability')).toBeVisible({ timeout: 15_000 })
  return layout
}
