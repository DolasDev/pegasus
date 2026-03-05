// ---------------------------------------------------------------------------
// Unit tests for tenant-resolver — resolveTenantsForEmail and selectTenant
//
// All network calls are intercepted via fetch spy. apiFetch is tested
// separately; here we only care that the right endpoint is called with
// the right body and that the return value is correctly shaped.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveTenantsForEmail, selectTenant } from './tenant-resolver'

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('../config', () => ({
  getConfig: () => ({ apiUrl: 'https://api.test' }),
}))

vi.mock('../auth/session', () => ({
  getSession: () => null,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOkResponse(body: unknown) {
  return new Response(JSON.stringify({ data: body }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeErrorResponse(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const mockTenants = [
  {
    tenantId: 'tenant-1',
    tenantName: 'Acme Corp',
    cognitoAuthEnabled: true,
    providers: [],
  },
  {
    tenantId: 'tenant-2',
    tenantName: 'Beta Inc',
    cognitoAuthEnabled: false,
    providers: [{ id: 'BetaOkta', name: 'Beta Okta', type: 'oidc' }],
  },
]

// ---------------------------------------------------------------------------
// resolveTenantsForEmail
// ---------------------------------------------------------------------------

describe('resolveTenantsForEmail', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('calls POST /api/auth/resolve-tenants with the email', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(makeOkResponse(mockTenants)))

    await resolveTenantsForEmail('user@acme.com')

    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toContain('/api/auth/resolve-tenants')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ email: 'user@acme.com' })
  })

  it('returns the array of TenantResolution objects', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(makeOkResponse(mockTenants)),
    )

    const result = await resolveTenantsForEmail('user@acme.com')

    expect(result).toHaveLength(2)
    expect(result[0]!.tenantId).toBe('tenant-1')
    expect(result[1]!.tenantName).toBe('Beta Inc')
  })

  it('returns empty array when no tenants found', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(makeOkResponse([])))

    const result = await resolveTenantsForEmail('user@unknown.com')
    expect(result).toEqual([])
  })

  it('rethrows unexpected errors (500, network failure)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(makeErrorResponse(500, 'INTERNAL_ERROR', 'Something went wrong')),
    )

    await expect(resolveTenantsForEmail('user@acme.com')).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// selectTenant
// ---------------------------------------------------------------------------

describe('selectTenant', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('calls POST /api/auth/select-tenant with email and tenantId', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(makeOkResponse(mockTenants[0]!)))

    await selectTenant('user@acme.com', 'tenant-1')

    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toContain('/api/auth/select-tenant')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      email: 'user@acme.com',
      tenantId: 'tenant-1',
    })
  })

  it('returns a single TenantResolution on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(makeOkResponse(mockTenants[0]!)),
    )

    const result = await selectTenant('user@acme.com', 'tenant-1')

    expect(result.tenantId).toBe('tenant-1')
    expect(result.tenantName).toBe('Acme Corp')
    expect(result.cognitoAuthEnabled).toBe(true)
  })

  it('rethrows 403 FORBIDDEN errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(makeErrorResponse(403, 'FORBIDDEN', 'You are not invited')),
    )

    await expect(selectTenant('stranger@acme.com', 'tenant-1')).rejects.toThrow()
  })

  it('rethrows 404 NOT_FOUND errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(makeErrorResponse(404, 'NOT_FOUND', 'Tenant not found')),
    )

    await expect(selectTenant('user@acme.com', 'nonexistent')).rejects.toThrow()
  })
})
