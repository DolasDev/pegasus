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

const API_PORT = parseInt(process.env['PORT'] ?? '3001', 10)
const API_BASE_URL = `http://localhost:${API_PORT}`

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',

  use: {
    baseURL: API_BASE_URL,
    trace: 'on-first-retry',
  },

  globalSetup: './global-setup.ts',

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

  webServer: {
    command: `node ../../node_modules/.bin/tsx ../../packages/api/src/server.ts`,
    url: `${API_BASE_URL}/health`,
    reuseExistingServer: !process.env['CI'],
    timeout: 30000,
    env: {
      DATABASE_URL: process.env['DATABASE_URL'] ?? '',
      DIRECT_URL: process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'] ?? '',
      DEFAULT_TENANT_ID: process.env['DEFAULT_TENANT_ID'] ?? 'e2e00000-0000-0000-0000-000000000001',
      SKIP_AUTH: process.env['SKIP_AUTH'] ?? 'true',
      PORT: String(API_PORT),
      HOST: process.env['HOST'] ?? '0.0.0.0',
      NODE_ENV: 'test',
    },
  },
})
