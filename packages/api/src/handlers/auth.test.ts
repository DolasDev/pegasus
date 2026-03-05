// ---------------------------------------------------------------------------
// Unit tests for the auth handler — new multi-tenant endpoints
//
// Tests POST /api/auth/resolve-tenants and POST /api/auth/select-tenant.
//
// The db module is mocked via vi.hoisted() so mock fns are available before
// the module factory runs. authHandler imports `db` from '../db' (singleton),
// so vi.mock('../db') intercepts it before authHandler is imported.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { authHandler } from './auth'

// ---------------------------------------------------------------------------
// db mock
// ---------------------------------------------------------------------------

const {
  mockTenantFindFirst,
  mockTenantUserFindMany,
  mockTenantUserFindUnique,
  mockAuthSessionCreate,
} = vi.hoisted(() => ({
  mockTenantFindFirst: vi.fn(),
  mockTenantUserFindMany: vi.fn(),
  mockTenantUserFindUnique: vi.fn(),
  mockAuthSessionCreate: vi.fn(),
}))

vi.mock('../db', () => ({
  db: {
    tenant: { findFirst: mockTenantFindFirst },
    tenantUser: {
      findMany: mockTenantUserFindMany,
      findUnique: mockTenantUserFindUnique,
    },
    authSession: { create: mockAuthSessionCreate },
  },
}))

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/** A minimal TenantUser row joined to a Tenant with ssoProviders. */
function makeTenantUserWithTenant(overrides?: {
  tenantId?: string
  tenantName?: string
  cognitoAuthEnabled?: boolean
  ssoProviders?: unknown[]
  status?: string
}) {
  return {
    status: overrides?.status ?? 'ACTIVE',
    tenant: {
      id: overrides?.tenantId ?? 'tenant-uuid-1',
      name: overrides?.tenantName ?? 'Acme Corp',
      cognitoAuthEnabled: overrides?.cognitoAuthEnabled ?? true,
      ssoProviders: overrides?.ssoProviders ?? [],
    },
  }
}

function makeTenantRow(overrides?: {
  id?: string
  name?: string
  cognitoAuthEnabled?: boolean
  ssoProviders?: unknown[]
}) {
  return {
    id: overrides?.id ?? 'tenant-uuid-1',
    name: overrides?.name ?? 'Acme Corp',
    cognitoAuthEnabled: overrides?.cognitoAuthEnabled ?? true,
    ssoProviders: overrides?.ssoProviders ?? [],
  }
}

// ---------------------------------------------------------------------------
// POST /api/auth/resolve-tenants
// ---------------------------------------------------------------------------

describe('POST /api/auth/resolve-tenants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with an array of tenants when TenantUser records exist', async () => {
    mockTenantUserFindMany.mockResolvedValue([
      makeTenantUserWithTenant({ tenantId: 'tenant-1', tenantName: 'Acme' }),
      makeTenantUserWithTenant({ tenantId: 'tenant-2', tenantName: 'Beta Inc' }),
    ])

    const res = await authHandler.request('/resolve-tenants', post({ email: 'user@company.com' }))
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body.data as JsonBody[]
    expect(data).toHaveLength(2)
    expect(data[0]!['tenantId']).toBe('tenant-1')
    expect(data[1]!['tenantId']).toBe('tenant-2')
  })

  it('returns tenantName, cognitoAuthEnabled, and providers in each item', async () => {
    mockTenantUserFindMany.mockResolvedValue([
      makeTenantUserWithTenant({
        tenantName: 'Acme Corp',
        cognitoAuthEnabled: false,
        ssoProviders: [{ cognitoProviderName: 'AcmeOkta', name: 'Acme Okta', type: 'OIDC' }],
      }),
    ])

    const res = await authHandler.request('/resolve-tenants', post({ email: 'user@acme.com' }))
    expect(res.status).toBe(200)
    const item = ((await json(res)).data as JsonBody[])[0] as JsonBody
    expect(item['tenantName']).toBe('Acme Corp')
    expect(item['cognitoAuthEnabled']).toBe(false)
    expect(item['providers']).toEqual([{ id: 'AcmeOkta', name: 'Acme Okta', type: 'oidc' }])
  })

  it('lowercases the provider type in the response', async () => {
    mockTenantUserFindMany.mockResolvedValue([
      makeTenantUserWithTenant({
        ssoProviders: [{ cognitoProviderName: 'OktaSAML', name: 'Okta', type: 'SAML' }],
      }),
    ])

    const res = await authHandler.request('/resolve-tenants', post({ email: 'user@acme.com' }))
    const item = ((await json(res)).data as JsonBody[])[0] as JsonBody
    const providers = item['providers'] as JsonBody[]
    expect(providers[0]!['type']).toBe('saml')
  })

  it('queries TenantUser with status not DEACTIVATED and tenant status ACTIVE', async () => {
    mockTenantUserFindMany.mockResolvedValue([])
    mockTenantFindFirst.mockResolvedValue(null)

    await authHandler.request('/resolve-tenants', post({ email: 'user@acme.com' }))

    expect(mockTenantUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: 'user@acme.com',
          status: { not: 'DEACTIVATED' },
          tenant: { status: 'ACTIVE' },
        }),
      }),
    )
  })

  it('falls back to domain lookup when no TenantUser records found', async () => {
    mockTenantUserFindMany.mockResolvedValue([])
    mockTenantFindFirst.mockResolvedValue(
      makeTenantRow({ id: 'domain-tenant', name: 'Domain Corp' }),
    )

    const res = await authHandler.request('/resolve-tenants', post({ email: 'user@domain.com' }))
    expect(res.status).toBe(200)
    const data = (await json(res)).data as JsonBody[]
    expect(data).toHaveLength(1)
    expect(data[0]!['tenantId']).toBe('domain-tenant')
  })

  it('returns 200 with empty array when neither TenantUser nor domain lookup finds anything', async () => {
    mockTenantUserFindMany.mockResolvedValue([])
    mockTenantFindFirst.mockResolvedValue(null)

    const res = await authHandler.request('/resolve-tenants', post({ email: 'user@unknown.com' }))
    expect(res.status).toBe(200)
    const data = (await json(res)).data as JsonBody[]
    expect(data).toHaveLength(0)
  })

  it('returns 400 VALIDATION_ERROR when email is missing', async () => {
    const res = await authHandler.request('/resolve-tenants', post({}))
    expect(res.status).toBe(400)
    expect((await json(res)).code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 VALIDATION_ERROR when email is not a valid email address', async () => {
    const res = await authHandler.request('/resolve-tenants', post({ email: 'notanemail' }))
    expect(res.status).toBe(400)
    expect((await json(res)).code).toBe('VALIDATION_ERROR')
  })

  it('returns 500 on DB error', async () => {
    mockTenantUserFindMany.mockRejectedValue(new Error('DB connection failed'))

    const res = await authHandler.request('/resolve-tenants', post({ email: 'user@acme.com' }))
    expect(res.status).toBe(500)
    expect((await json(res)).code).toBe('INTERNAL_ERROR')
  })
})

// ---------------------------------------------------------------------------
// POST /api/auth/select-tenant
// ---------------------------------------------------------------------------

describe('POST /api/auth/select-tenant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with TenantResolution on success', async () => {
    mockTenantUserFindUnique.mockResolvedValue({ status: 'ACTIVE' })
    mockTenantFindFirst.mockResolvedValue(
      makeTenantRow({ id: 'tenant-1', name: 'Acme Corp', cognitoAuthEnabled: true }),
    )
    mockAuthSessionCreate.mockResolvedValue({})

    const res = await authHandler.request(
      '/select-tenant',
      post({ email: 'user@acme.com', tenantId: 'tenant-1' }),
    )
    expect(res.status).toBe(200)
    const data = (await json(res)).data as JsonBody
    expect(data['tenantId']).toBe('tenant-1')
    expect(data['tenantName']).toBe('Acme Corp')
    expect(data['cognitoAuthEnabled']).toBe(true)
  })

  it('creates an AuthSession with 10-minute expiry', async () => {
    const before = Date.now()
    mockTenantUserFindUnique.mockResolvedValue({ status: 'ACTIVE' })
    mockTenantFindFirst.mockResolvedValue(makeTenantRow())
    mockAuthSessionCreate.mockResolvedValue({})

    await authHandler.request(
      '/select-tenant',
      post({ email: 'user@acme.com', tenantId: 'tenant-1' }),
    )
    const after = Date.now()

    expect(mockAuthSessionCreate).toHaveBeenCalledOnce()
    const createCall = mockAuthSessionCreate.mock.calls[0]![0] as {
      data: { email: string; tenantId: string; expiresAt: Date }
    }
    expect(createCall.data.email).toBe('user@acme.com')
    expect(createCall.data.tenantId).toBe('tenant-1')
    const expiresAt = createCall.data.expiresAt.getTime()
    expect(expiresAt).toBeGreaterThanOrEqual(before + 10 * 60 * 1000 - 100)
    expect(expiresAt).toBeLessThanOrEqual(after + 10 * 60 * 1000 + 100)
  })

  it('returns 403 FORBIDDEN when TenantUser not found (user not invited)', async () => {
    mockTenantUserFindUnique.mockResolvedValue(null)

    const res = await authHandler.request(
      '/select-tenant',
      post({ email: 'stranger@acme.com', tenantId: 'tenant-1' }),
    )
    expect(res.status).toBe(403)
    expect((await json(res)).code).toBe('FORBIDDEN')
  })

  it('returns 403 FORBIDDEN when TenantUser is DEACTIVATED', async () => {
    mockTenantUserFindUnique.mockResolvedValue({ status: 'DEACTIVATED' })

    const res = await authHandler.request(
      '/select-tenant',
      post({ email: 'gone@acme.com', tenantId: 'tenant-1' }),
    )
    expect(res.status).toBe(403)
    expect((await json(res)).code).toBe('FORBIDDEN')
  })

  it('returns 404 NOT_FOUND when tenant not found or not ACTIVE', async () => {
    mockTenantUserFindUnique.mockResolvedValue({ status: 'ACTIVE' })
    mockTenantFindFirst.mockResolvedValue(null)

    const res = await authHandler.request(
      '/select-tenant',
      post({ email: 'user@acme.com', tenantId: 'suspended-tenant' }),
    )
    expect(res.status).toBe(404)
    expect((await json(res)).code).toBe('NOT_FOUND')
  })

  it('does not create AuthSession when validation fails', async () => {
    mockTenantUserFindUnique.mockResolvedValue(null)

    await authHandler.request(
      '/select-tenant',
      post({ email: 'stranger@acme.com', tenantId: 'tenant-1' }),
    )

    expect(mockAuthSessionCreate).not.toHaveBeenCalled()
  })

  it('returns 400 VALIDATION_ERROR when email is missing', async () => {
    const res = await authHandler.request('/select-tenant', post({ tenantId: 'tenant-1' }))
    expect(res.status).toBe(400)
    expect((await json(res)).code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 VALIDATION_ERROR when tenantId is missing', async () => {
    const res = await authHandler.request('/select-tenant', post({ email: 'user@acme.com' }))
    expect(res.status).toBe(400)
    expect((await json(res)).code).toBe('VALIDATION_ERROR')
  })

  it('returns 500 on DB error', async () => {
    mockTenantUserFindUnique.mockRejectedValue(new Error('timeout'))

    const res = await authHandler.request(
      '/select-tenant',
      post({ email: 'user@acme.com', tenantId: 'tenant-1' }),
    )
    expect(res.status).toBe(500)
    expect((await json(res)).code).toBe('INTERNAL_ERROR')
  })

  it('accepts PENDING TenantUser status (invited, not yet logged in)', async () => {
    mockTenantUserFindUnique.mockResolvedValue({ status: 'PENDING' })
    mockTenantFindFirst.mockResolvedValue(makeTenantRow())
    mockAuthSessionCreate.mockResolvedValue({})

    const res = await authHandler.request(
      '/select-tenant',
      post({ email: 'new@acme.com', tenantId: 'tenant-1' }),
    )
    expect(res.status).toBe(200)
  })
})
