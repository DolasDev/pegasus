import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ---------------------------------------------------------------------------
// Load env files before defineConfig so webServer.env / config logic see them.
//
//   .env.test.local — gitignored; per-developer overrides + secrets (e.g. the
//                     QA_* vars, E2E_STAGING_ADMIN_PASSWORD). Loaded first so it
//                     wins (loadDotEnv is first-write-wins; values already in
//                     process.env from the CLI win over both files).
//   .env.test       — tracked; committed defaults for the `local` target.
//
// See apps/e2e/.env.test.example.
// ---------------------------------------------------------------------------
function loadDotEnv(filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const rawVal = trimmed.slice(eqIdx + 1).trim()
      // Strip surrounding quotes
      const val = rawVal.replace(/^["']|["']$/g, '')
      if (!(key in process.env)) {
        process.env[key] = val
      }
    }
  } catch {
    // .env.test is optional in CI where env vars are injected directly
  }
}

loadDotEnv(resolve(__dirname, '.env.test.local'))
loadDotEnv(resolve(__dirname, '.env.test'))

// ---------------------------------------------------------------------------
// Target mode
// ---------------------------------------------------------------------------
// `local`  (default): spin up the API via `webServer` and run `globalSetup`
//                     (Prisma migrate + tenant seed) against local Postgres.
// `remote`          : skip `webServer` + `globalSetup`. Hits the API at
//                     `E2E_API_BASE_URL` (required) and excludes specs tagged
//                     `@local-only` (DB-seeded or auth-required). Used by the
//                     staging E2E gate in `.github/workflows/deploy.yml`.
// `qa`              : skip `webServer` + `globalSetup`. Browser-driven suite for
//                     the `/driver-planning` (longhaul) module against a real QA
//                     tenant with a live on-prem tunnel. Authenticates via a real
//                     Cognito login (see `fixtures/hosted-ui-login.ts`) captured by
//                     the `qa-setup` project. Runs only the `tests/**/longhaul/**`
//                     specs. See `apps/e2e/QA.md` for the full contract.
// See `apps/e2e/REMOTE.md` for the remote/qa contract.
// ---------------------------------------------------------------------------
const E2E_TARGET = process.env['E2E_TARGET'] ?? 'local'
const isRemote = E2E_TARGET === 'remote'
const isQa = E2E_TARGET === 'qa'
const isDeployed = isRemote || isQa

const API_PORT = parseInt(process.env['PORT'] ?? '3001', 10)
const LOCAL_API_BASE_URL = `http://localhost:${API_PORT}`

// QA_SESSION_PATH (where the qa-setup project writes the captured browser
// session) is imported from ./fixtures/qa-session-path so config + fixtures + the
// qa-setup spec all agree on the location. Re-exported here for backwards-compat.
export { QA_SESSION_PATH } from './fixtures/qa-session-path'

let baseURL: string
if (isQa) {
  const webUrl = process.env['QA_WEB_URL']
  const apiUrl = process.env['QA_API_BASE_URL']
  if (!webUrl) throw new Error('E2E_TARGET=qa requires QA_WEB_URL to be set')
  if (!apiUrl) throw new Error('E2E_TARGET=qa requires QA_API_BASE_URL to be set')
  // Browser specs navigate against the web app; the `apiFetch`/`qaApiFetch`
  // fixtures read API_BASE_URL for HTTP calls.
  baseURL = webUrl
  process.env['API_BASE_URL'] = apiUrl
} else if (isRemote) {
  const remoteUrl = process.env['E2E_API_BASE_URL']
  if (!remoteUrl) {
    throw new Error('E2E_TARGET=remote requires E2E_API_BASE_URL to be set')
  }
  baseURL = remoteUrl
  // The `apiFetch` fixture reads API_BASE_URL directly; mirror E2E_API_BASE_URL
  // into it so existing specs work unchanged in remote mode.
  process.env['API_BASE_URL'] = remoteUrl
} else {
  baseURL = LOCAL_API_BASE_URL
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',

  // In remote/qa mode, skip specs that depend on local DB seeding or SKIP_AUTH.
  // See REMOTE.md for the tagging contract.
  ...(isDeployed ? { grepInvert: /@local-only/ } : {}),

  use: {
    baseURL,
    trace: 'on-first-retry',
  },

  // Local mode runs Prisma migrate + tenant seed; remote/qa modes hit a live env.
  ...(isDeployed
    ? {}
    : {
        globalSetup: './global-setup.ts',
        webServer: {
          command: `node ../../node_modules/.bin/tsx ../api/src/server.ts`,
          url: `${LOCAL_API_BASE_URL}/health`,
          reuseExistingServer: !process.env['CI'],
          timeout: 30000,
          env: {
            DATABASE_URL: process.env['DATABASE_URL'] ?? '',
            DIRECT_URL: process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'] ?? '',
            DEFAULT_TENANT_ID:
              process.env['DEFAULT_TENANT_ID'] ?? 'e2e00000-0000-0000-0000-000000000001',
            SKIP_AUTH: process.env['SKIP_AUTH'] ?? 'true',
            PORT: String(API_PORT),
            HOST: process.env['HOST'] ?? '0.0.0.0',
            NODE_ENV: 'test',
          },
        },
      }),

  projects: isQa
    ? [
        // qa-setup performs a real Cognito login once and writes the captured
        // browser session (cookies + sessionStorage) to QA_SESSION_PATH.
        {
          name: 'qa-setup',
          testMatch: /tests\/qa-setup\.ts$/,
          use: { ...devices['Desktop Chrome'] },
        },
        // qa-api: HTTP-level checks of /api/v1/longhaul/* against QA. Reuses the
        // ID token captured by qa-setup; no browser needed.
        {
          name: 'qa-api',
          testMatch: 'tests/api/longhaul-qa.spec.ts',
          dependencies: ['qa-setup'],
          use: { ...devices['Desktop Chrome'] },
        },
        // qa-browser: drives the /driver-planning UI as the logged-in QA user.
        {
          name: 'qa-browser',
          testMatch: 'tests/browser/longhaul/**/*.spec.ts',
          dependencies: ['qa-setup'],
          use: { ...devices['Desktop Chrome'] },
        },
      ]
    : [
        {
          name: 'api',
          testMatch: 'tests/api/**/*.spec.ts',
          // longhaul-qa.spec.ts only runs under E2E_TARGET=qa (needs a live QA
          // tenant + on-prem tunnel + a real login). Excluded from local/remote.
          testIgnore: '**/longhaul-qa.spec.ts',
          use: {
            // API tests don't need a browser
            ...devices['Desktop Chrome'],
          },
        },
        {
          name: 'browser',
          testMatch: 'tests/browser/**/*.spec.ts',
          // tests/browser/longhaul/** only runs under E2E_TARGET=qa.
          testIgnore: 'tests/browser/longhaul/**',
          use: {
            ...devices['Desktop Chrome'],
          },
        },
      ],
})
