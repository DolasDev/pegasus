import type { BrowserContext, Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Real login flow for tenant-web (QA target).
//
// Unlike `fixtures/auth.ts` (which seeds fake admin-web tokens for mocked
// specs), this drives the *actual* tenant-web `/login` UI against a deployed QA
// environment and produces a genuine session. tenant-web stores its session in
// `sessionStorage['pegasus.session']` (see `apps/tenant-web/src/auth/session.ts`),
// which Playwright's `storageState` does NOT persist — so we capture both the
// cookies/localStorage (via `context.storageState()`) and the sessionStorage
// blob, and the `qaTest` fixture re-injects sessionStorage into each context.
//
// The login form (`apps/tenant-web/src/routes/login.tsx`) is a small state
// machine: email → (tenant picker, if the email maps to >1 tenant) →
// (provider picker, if SSO providers are configured) → password → (MFA /
// new-password challenges) → redirect to `/dashboard`. This helper walks the
// Cognito-native username/password path. Federated-IdP tenants need the
// IdP-specific form filled at the `select-provider` step — see QA.md; that
// branch is intentionally a TODO until the QA tenant's IdP is known.
// ---------------------------------------------------------------------------

export interface QaLoginConfig {
  /** Web app base URL, e.g. https://pegasus-qa.dolas.dev */
  webUrl: string
  /** Login email / Cognito username for the QA test user. */
  username: string
  /** Password for the QA test user (permanent — no FORCE_CHANGE_PASSWORD). */
  password: string
  /**
   * Tenant display name, used to disambiguate when the email maps to >1 tenant.
   * Optional — if omitted and a picker appears, the first tenant is chosen.
   */
  tenantName?: string | undefined
}

export interface CapturedSession {
  /** Playwright storageState (cookies + per-origin localStorage). */
  storageState: Awaited<ReturnType<BrowserContext['storageState']>>
  /** Origin of the web app (key for sessionStorage restoration). */
  origin: string
  /** sessionStorage entries captured after a successful login. */
  sessionStorage: Record<string, string>
  /** The Cognito ID token (parsed out of the session) — used by qa-api specs. */
  idToken: string
}

const SESSION_KEY = 'pegasus.session'

/**
 * Drives the tenant-web login UI and returns the captured browser session.
 * Throws with an actionable message on every failure path (unexpected step,
 * MFA challenge, missing session, etc.).
 */
export async function loginToQa(page: Page, cfg: QaLoginConfig): Promise<CapturedSession> {
  const origin = new URL(cfg.webUrl).origin

  await page.goto(`${cfg.webUrl.replace(/\/$/, '')}/login`, { waitUntil: 'domcontentloaded' })

  // Step: email
  await page.getByLabel('Work email').fill(cfg.username)
  await page.getByRole('button', { name: 'Continue' }).click()

  // The next visible step depends on the email's tenant mapping. Poll for
  // whichever card renders. Generous timeout: `resolve-tenants` round-trips
  // through the API → Cognito.
  await page.waitForLoadState('networkidle').catch(() => {})

  // Step: select-tenant (only when the email maps to >1 tenant)
  const tenantPickerHeading = page.getByText('Choose your organization')
  if (await tenantPickerHeading.isVisible().catch(() => false)) {
    const button = cfg.tenantName
      ? page.getByRole('button', { name: cfg.tenantName, exact: false })
      : page.getByRole('button').filter({ hasNotText: 'Use a different email' }).first()
    await button.click()
    await page.waitForLoadState('networkidle').catch(() => {})
  }

  // Step: select-provider (only when SSO providers are configured for the
  // tenant). The Cognito-native path is the "Sign in with password" button.
  const providerHeading = page.getByText('Choose your sign-in method')
  if (await providerHeading.isVisible().catch(() => false)) {
    const passwordButton = page.getByRole('button', { name: 'Sign in with password' })
    if (!(await passwordButton.isVisible().catch(() => false))) {
      throw new Error(
        'QA login: the tenant only offers federated SSO providers, but this helper only ' +
          'supports the Cognito-native username/password path. Add the IdP-specific form ' +
          'handling here (see apps/e2e/QA.md) once the QA tenant IdP is known.',
      )
    }
    await passwordButton.click()
  }

  // Step: password
  const passwordField = page.getByLabel('Password')
  await passwordField.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {
    throw new Error(
      'QA login: never reached the password step. Check QA_USER_USERNAME maps to a tenant ' +
        'with cognitoAuthEnabled, and that QA_TENANT_NAME (if set) matches the picker label.',
    )
  })
  await passwordField.fill(cfg.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  // MFA / new-password challenges are not automatable here — fail loudly.
  for (const challenge of ['One-time code', 'New password']) {
    if (
      await page
        .getByLabel(challenge)
        .isVisible({ timeout: 2000 })
        .catch(() => false)
    ) {
      throw new Error(
        `QA login: hit a "${challenge}" challenge. The QA test user must have MFA disabled and a ` +
          `permanent password (AdminSetUserPassword --permanent).`,
      )
    }
  }

  // Success: tenant-web does `window.location.replace('/dashboard')` after
  // storing the session. Wait for the navigation and the session key.
  await page.waitForURL(/\/dashboard\b/, { timeout: 30_000 })
  await page.waitForFunction((key) => !!window.sessionStorage.getItem(key), SESSION_KEY, {
    timeout: 10_000,
  })

  const sessionStorageEntries = await page.evaluate(() => {
    const out: Record<string, string> = {}
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i)
      if (k) out[k] = window.sessionStorage.getItem(k) ?? ''
    }
    return out
  })

  const rawSession = sessionStorageEntries[SESSION_KEY]
  if (!rawSession) {
    throw new Error('QA login: dashboard reached but no session in sessionStorage.')
  }
  let idToken: string
  try {
    const parsed = JSON.parse(rawSession) as { token?: string }
    if (!parsed.token) throw new Error('session has no `token` field')
    idToken = parsed.token
  } catch (err) {
    throw new Error(
      `QA login: could not parse the stored session: ${err instanceof Error ? err.message : err}`,
      { cause: err },
    )
  }

  const storageState = await page.context().storageState()

  return { storageState, origin, sessionStorage: sessionStorageEntries, idToken }
}
