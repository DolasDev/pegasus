import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ---------------------------------------------------------------------------
// Load .env.test before defineConfig so webServer.env picks up the values.
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
// See `apps/e2e/REMOTE.md` for the full remote contract.
// ---------------------------------------------------------------------------
const E2E_TARGET = process.env['E2E_TARGET'] ?? 'local'
const isRemote = E2E_TARGET === 'remote'

const API_PORT = parseInt(process.env['PORT'] ?? '3001', 10)
const LOCAL_API_BASE_URL = `http://localhost:${API_PORT}`

let baseURL: string
if (isRemote) {
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

  // In remote mode, skip specs that depend on local DB seeding or SKIP_AUTH.
  // See REMOTE.md for the tagging contract.
  ...(isRemote ? { grepInvert: /@local-only/ } : {}),

  use: {
    baseURL,
    trace: 'on-first-retry',
  },

  // Local mode runs Prisma migrate + tenant seed; remote mode hits a live env.
  ...(isRemote
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

  projects: [
    {
      name: 'api',
      testMatch: 'tests/api/**/*.spec.ts',
      use: {
        // API tests don't need a browser
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'browser',
      testMatch: 'tests/browser/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
})
