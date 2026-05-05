import type { Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Browser-spec auth helpers for admin-web.
//
// admin-web's auth guard (`apps/admin-web/src/routes/_auth.tsx`) is a
// synchronous `sessionStorage` check via `getAccessToken()`. We satisfy it by
// seeding dummy Cognito-shaped tokens before any page script runs. The values
// are never sent to a real Cognito or AVP endpoint — every API call exercised
// by these specs is mocked with `page.route`.
//
// This is the cheap "@local-only" path documented in
// `plans/in-progress/vpn-diagnose-spec-uat.md` step 1(a). A real Hosted-UI
// (or USER_PASSWORD_AUTH) login fixture is path 1(b) — its own follow-up.
// ---------------------------------------------------------------------------

const STORAGE_KEY_ACCESS_TOKEN = 'pegasus_admin_access_token'
const STORAGE_KEY_ID_TOKEN = 'pegasus_admin_id_token'
const STORAGE_KEY_REFRESH_TOKEN = 'pegasus_admin_refresh_token'

/**
 * Primes sessionStorage with dummy Cognito tokens so admin-web's authGuard
 * lets the spec reach `_auth/*` routes. Must be called before the first
 * `page.goto` — uses `addInitScript` so the values land before the React
 * tree (and therefore the auth guard) ever evaluates.
 */
export async function seedAdminAuth(page: Page): Promise<void> {
  await page.addInitScript(
    ({ accessKey, idKey, refreshKey }) => {
      window.sessionStorage.setItem(accessKey, 'e2e-fake-access-token')
      window.sessionStorage.setItem(idKey, 'e2e-fake-id-token')
      window.sessionStorage.setItem(refreshKey, 'e2e-fake-refresh-token')
    },
    {
      accessKey: STORAGE_KEY_ACCESS_TOKEN,
      idKey: STORAGE_KEY_ID_TOKEN,
      refreshKey: STORAGE_KEY_REFRESH_TOKEN,
    },
  )
}
