import { test as base } from '@playwright/test'
import { getAdminIdToken } from './cognito'

const API_BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001'
const TENANT_ID = process.env['TEST_TENANT_ID'] ?? 'e2e00000-0000-0000-0000-000000000001'

/**
 * apiFetch — wraps `fetch` with the base URL and required headers for the
 * SKIP_AUTH API. Content-Type is set to application/json automatically.
 */
type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

export const test = base.extend<{
  apiFetch: ApiFetch
  authedApiFetch: ApiFetch
  tenantId: string
}>({
  // Playwright introspects the first arg's destructured properties to infer
  // dependencies on other fixtures, so it must be an object pattern even when
  // the fixture has no deps. Empty `{}` triggers eslint's no-empty-pattern;
  // disabled per-line because that's the canonical Playwright shape.
  // eslint-disable-next-line no-empty-pattern
  tenantId: async ({}, use) => {
    await use(TENANT_ID)
  },

  // eslint-disable-next-line no-empty-pattern
  apiFetch: async ({}, use) => {
    const fetch_ = (path: string, init: RequestInit = {}): Promise<Response> => {
      const url = `${API_BASE}${path}`
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-tenant-id': TENANT_ID,
        'x-correlation-id': `e2e-${Date.now()}`,
        ...(init.headers as Record<string, string> | undefined),
      }
      return fetch(url, { ...init, headers })
    }
    await use(fetch_)
  },

  // authedApiFetch — like apiFetch but injects a real Cognito ID token and
  // the tenant ID provisioned for the staging E2E admin. Used by the
  // authenticated AVP smoke spec; throws clearly if env is missing.
  // eslint-disable-next-line no-empty-pattern
  authedApiFetch: async ({}, use) => {
    const token = await getAdminIdToken()
    const stagingTenantId = process.env['E2E_STAGING_TENANT_ID']
    if (!stagingTenantId) {
      throw new Error(
        'remote-mode auth not configured: missing E2E_STAGING_TENANT_ID. ' +
          'See apps/e2e/REMOTE.md.',
      )
    }
    const fetch_ = (path: string, init: RequestInit = {}): Promise<Response> => {
      const url = `${API_BASE}${path}`
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-tenant-id': stagingTenantId,
        'x-correlation-id': `e2e-${Date.now()}`,
        ...(init.headers as Record<string, string> | undefined),
      }
      return fetch(url, { ...init, headers })
    }
    await use(fetch_)
  },
})

export { expect } from '@playwright/test'
