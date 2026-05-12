import { test as base, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { QA_SESSION_PATH } from './qa-session-path'
import type { CapturedSession } from './hosted-ui-login'

// ---------------------------------------------------------------------------
// QA-target fixtures.
//
// `qaTest` extends Playwright's base `test` with:
//   - a `page` that has the captured tenant-web session (sessionStorage +
//     localStorage + cookies) restored before any app script runs, so specs
//     start already logged in as the QA test user;
//   - `qaApiFetch`: a `fetch` wrapper hitting QA_API_BASE_URL with the QA
//     user's real Cognito ID token + tenant id (for direct API assertions);
//   - `qaWebUrl` / `qaTenantId`: resolved QA env values.
//
// The session file at QA_SESSION_PATH is produced by the `qa-setup` project
// (see `tests/qa-setup.ts` → `fixtures/hosted-ui-login.ts`). It is `.gitignore`d.
// ---------------------------------------------------------------------------

export interface QaEnv {
  webUrl: string
  apiBaseUrl: string
  tenantId: string
  username: string
  password: string
  tenantName?: string | undefined
}

/** Reads + validates the QA_* env vars. Throws an actionable error if missing. */
export function qaEnv(): QaEnv {
  const required = {
    QA_WEB_URL: process.env['QA_WEB_URL'],
    QA_API_BASE_URL: process.env['QA_API_BASE_URL'],
    QA_TENANT_ID: process.env['QA_TENANT_ID'],
    QA_USER_USERNAME: process.env['QA_USER_USERNAME'],
    QA_USER_PASSWORD: process.env['QA_USER_PASSWORD'],
  }
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length) {
    throw new Error(`E2E_TARGET=qa requires ${missing.join(', ')} to be set. See apps/e2e/QA.md.`)
  }
  return {
    webUrl: required.QA_WEB_URL!.replace(/\/$/, ''),
    apiBaseUrl: required.QA_API_BASE_URL!.replace(/\/$/, ''),
    tenantId: required.QA_TENANT_ID!,
    username: required.QA_USER_USERNAME!,
    password: required.QA_USER_PASSWORD!,
    tenantName: process.env['QA_TENANT_NAME'] || undefined,
  }
}

/** Loads the session captured by the qa-setup project. */
export function loadCapturedSession(): CapturedSession {
  try {
    return JSON.parse(readFileSync(QA_SESSION_PATH, 'utf-8')) as CapturedSession
  } catch (err) {
    throw new Error(
      `QA session not found at ${QA_SESSION_PATH}. The qa-setup project must run first ` +
        `(it is a project dependency of qa-browser/qa-api). Underlying error: ` +
        `${err instanceof Error ? err.message : err}`,
      { cause: err },
    )
  }
}

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

export const qaTest = base.extend<{
  qaApiFetch: ApiFetch
  qaWebUrl: string
  qaTenantId: string
}>({
  // eslint-disable-next-line no-empty-pattern
  qaWebUrl: async ({}, use) => {
    await use(qaEnv().webUrl)
  },

  // eslint-disable-next-line no-empty-pattern
  qaTenantId: async ({}, use) => {
    await use(qaEnv().tenantId)
  },

  context: async ({ context }, use) => {
    const { storageState } = loadCapturedSession()
    if (storageState.cookies?.length) {
      await context.addCookies(storageState.cookies)
    }
    await use(context)
  },

  page: async ({ page }, use) => {
    const { origin, sessionStorage, storageState } = loadCapturedSession()
    const localStorageForOrigin =
      storageState.origins?.find((o) => o.origin === origin)?.localStorage ?? []

    await page.addInitScript(
      ({ targetOrigin, session, local }) => {
        if (window.location.origin !== targetOrigin) return
        for (const [k, v] of Object.entries(session)) {
          window.sessionStorage.setItem(k, v as string)
        }
        for (const { name, value } of local) {
          window.localStorage.setItem(name, value)
        }
      },
      { targetOrigin: origin, session: sessionStorage, local: localStorageForOrigin },
    )
    await use(page)
  },

  // eslint-disable-next-line no-empty-pattern
  qaApiFetch: async ({}, use) => {
    const { apiBaseUrl, tenantId } = qaEnv()
    const { idToken } = loadCapturedSession()
    const fetch_ = (path: string, init: RequestInit = {}): Promise<Response> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        'x-tenant-id': tenantId,
        'x-correlation-id': `e2e-qa-${Date.now()}`,
        ...(init.headers as Record<string, string> | undefined),
      }
      return fetch(`${apiBaseUrl}${path}`, { ...init, headers })
    }
    await use(fetch_)
  },
})

export { expect }
