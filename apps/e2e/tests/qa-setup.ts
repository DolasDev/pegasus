import { test as setup, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { QA_SESSION_PATH } from '../fixtures/qa-session-path'
import { loginToQa } from '../fixtures/hosted-ui-login'
import { qaEnv } from '../fixtures/qa'

// ---------------------------------------------------------------------------
// qa-setup — runs once before the qa-browser / qa-api projects.
//
// Performs a real login against the QA tenant-web (`fixtures/hosted-ui-login.ts`)
// and writes the captured browser session (cookies + sessionStorage + the ID
// token) to QA_SESSION_PATH. All downstream specs read it via `loadCapturedSession()`.
// ---------------------------------------------------------------------------

setup('authenticate against the QA tenant', async ({ page }) => {
  const env = qaEnv()

  const captured = await loginToQa(page, {
    webUrl: env.webUrl,
    username: env.username,
    password: env.password,
    tenantName: env.tenantName,
  })

  expect(captured.idToken, 'login should yield a Cognito ID token').toBeTruthy()

  mkdirSync(dirname(QA_SESSION_PATH), { recursive: true })
  writeFileSync(QA_SESSION_PATH, JSON.stringify(captured, null, 2), 'utf-8')
})
