import { test as base } from '@playwright/test'

const API_BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001'
const TENANT_ID = process.env['TEST_TENANT_ID'] ?? 'e2e00000-0000-0000-0000-000000000001'

/**
 * apiFetch — wraps `fetch` with the base URL and required headers for the
 * SKIP_AUTH API. Content-Type is set to application/json automatically.
 */
type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

export const test = base.extend<{ apiFetch: ApiFetch; tenantId: string }>({
  tenantId: async ({}, use) => {
    await use(TENANT_ID)
  },

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
})

export { expect } from '@playwright/test'
