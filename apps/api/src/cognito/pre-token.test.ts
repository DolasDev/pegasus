// ---------------------------------------------------------------------------
// Unit tests for the Cognito pre-token-generation Lambda trigger
//
// @prisma/client is fully mocked so tests run without any database connection.
// PrismaClient is constructed at module level in pre-token.ts, so vi.hoisted()
// is used to ensure the mock functions are available before the factory
// runs and the module is imported.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context } from 'aws-lambda'

// ---------------------------------------------------------------------------
// Prisma mock — hoisted so the fns are available inside the vi.mock factory
// ---------------------------------------------------------------------------

const {
  mockTenantFindFirst,
  mockTenantUserFindUnique,
  mockTenantUserUpdate,
  mockAuthSessionFindFirst,
  mockAuthSessionDeleteMany,
} = vi.hoisted(() => ({
  mockTenantFindFirst: vi.fn(),
  mockTenantUserFindUnique: vi.fn(),
  mockTenantUserUpdate: vi.fn(),
  mockAuthSessionFindFirst: vi.fn(),
  mockAuthSessionDeleteMany: vi.fn(),
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    tenant: { findFirst: mockTenantFindFirst },
    tenantUser: {
      findUnique: mockTenantUserFindUnique,
      update: mockTenantUserUpdate,
    },
    authSession: {
      findFirst: mockAuthSessionFindFirst,
      deleteMany: mockAuthSessionDeleteMany,
    },
  })),
}))

import { handler } from './pre-token'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeContext = {} as Context
const fakeCallback = () => undefined

/** Builds a minimal PreTokenGeneration trigger event. */
function makeEvent({
  email,
  sub,
  groups = [],
}: {
  email?: string
  sub?: string
  groups?: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): any {
  return {
    version: '1',
    triggerSource: 'TokenGeneration_Authentication' as const,
    region: 'us-east-1',
    userPoolId: 'us-east-1_test',
    callerContext: { awsSdkVersion: '1', clientId: 'test-client' },
    userName: 'test-user',
    request: {
      userAttributes: {
        ...(email ? { email } : {}),
        ...(sub ? { sub } : {}),
      },
      groupConfiguration: { groupsToOverride: groups, iamRolesToOverride: [], preferredRole: '' },
    },
    response: { claimsOverrideDetails: {} },
  }
}

/** A resolved ACTIVE TenantUser with USER role. */
function activeTenantUser(overrides?: Partial<{ role: string; status: string }>) {
  return { id: 'user-uuid', role: 'USER', status: 'ACTIVE', ...overrides }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pre-token trigger', () => {
  beforeEach(() => {
    mockTenantFindFirst.mockReset()
    mockTenantUserFindUnique.mockReset()
    mockTenantUserUpdate.mockReset()
    mockAuthSessionFindFirst.mockReset()
    mockAuthSessionDeleteMany.mockReset()
    // Default: no auth session pending (most tests use domain-based flow)
    mockAuthSessionFindFirst.mockResolvedValue(null)
    mockAuthSessionDeleteMany.mockResolvedValue({ count: 0 })
  })

  // ── Platform admin path ───────────────────────────────────────────────────

  it('injects custom:role=platform_admin for PLATFORM_ADMIN users', async () => {
    const event = makeEvent({ email: 'admin@pegasus.com', groups: ['PLATFORM_ADMIN'] })
    const result = await handler(event, fakeContext, fakeCallback)

    expect(result.response.claimsOverrideDetails?.claimsToAddOrOverride?.['custom:role']).toBe(
      'platform_admin',
    )
  })

  it('does not inject custom:tenantId for PLATFORM_ADMIN users', async () => {
    const event = makeEvent({ email: 'admin@pegasus.com', groups: ['PLATFORM_ADMIN'] })
    const result = await handler(event, fakeContext, fakeCallback)

    expect(
      result.response.claimsOverrideDetails?.claimsToAddOrOverride?.['custom:tenantId'],
    ).toBeUndefined()
  })

  it('skips the DB lookup entirely for PLATFORM_ADMIN users', async () => {
    const event = makeEvent({ email: 'admin@pegasus.com', groups: ['PLATFORM_ADMIN'] })
    await handler(event, fakeContext, fakeCallback)

    expect(mockTenantFindFirst).not.toHaveBeenCalled()
    expect(mockTenantUserFindUnique).not.toHaveBeenCalled()
  })

  // ── Tenant user path — happy path (ACTIVE user) ───────────────────────────

  it('injects custom:tenantId and custom:role=tenant_user for an ACTIVE USER', async () => {
    mockTenantFindFirst.mockResolvedValue({ id: 'tenant-uuid-123' })
    mockTenantUserFindUnique.mockResolvedValue(activeTenantUser({ role: 'USER', status: 'ACTIVE' }))

    const result = await handler(makeEvent({ email: 'user@acme.com' }), fakeContext, fakeCallback)

    const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride
    expect(claims?.['custom:tenantId']).toBe('tenant-uuid-123')
    expect(claims?.['custom:role']).toBe('tenant_user')
  })

  it('injects custom:role=tenant_admin for an ACTIVE ADMIN', async () => {
    mockTenantFindFirst.mockResolvedValue({ id: 'tenant-uuid-123' })
    mockTenantUserFindUnique.mockResolvedValue(
      activeTenantUser({ role: 'ADMIN', status: 'ACTIVE' }),
    )

    const result = await handler(makeEvent({ email: 'admin@acme.com' }), fakeContext, fakeCallback)

    const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride
    expect(claims?.['custom:role']).toBe('tenant_admin')
  })

  it('queries the DB with the email domain and status ACTIVE', async () => {
    mockTenantFindFirst.mockResolvedValue({ id: 'tenant-uuid-123' })
    mockTenantUserFindUnique.mockResolvedValue(activeTenantUser())

    await handler(makeEvent({ email: 'user@acme.com' }), fakeContext, fakeCallback)

    expect(mockTenantFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          emailDomains: { has: 'acme.com' },
          status: 'ACTIVE',
        }),
      }),
    )
  })

  it('lowercases the email domain before querying', async () => {
    mockTenantFindFirst.mockResolvedValue({ id: 'tenant-uuid-123' })
    mockTenantUserFindUnique.mockResolvedValue(activeTenantUser())

    await handler(makeEvent({ email: 'User@ACME.COM' }), fakeContext, fakeCallback)

    expect(mockTenantFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ emailDomains: { has: 'acme.com' } }),
      }),
    )
  })

  // ── PENDING user — first login ─────────────────────────────────────────────

  it('activates a PENDING user on first login and injects their role', async () => {
    mockTenantFindFirst.mockResolvedValue({ id: 'tenant-uuid-123' })
    mockTenantUserFindUnique.mockResolvedValue({
      id: 'user-uuid',
      role: 'ADMIN',
      status: 'PENDING',
    })
    mockTenantUserUpdate.mockResolvedValue({})

    const result = await handler(
      makeEvent({ email: 'new@acme.com', sub: 'cognito-sub-abc' }),
      fakeContext,
      fakeCallback,
    )

    const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride
    expect(claims?.['custom:role']).toBe('tenant_admin')
    expect(mockTenantUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-uuid' },
        data: expect.objectContaining({ status: 'ACTIVE', cognitoSub: 'cognito-sub-abc' }),
      }),
    )
  })

  // ── DEACTIVATED user ───────────────────────────────────────────────────────

  it('throws for a DEACTIVATED user', async () => {
    mockTenantFindFirst.mockResolvedValue({ id: 'tenant-uuid-123' })
    mockTenantUserFindUnique.mockResolvedValue(activeTenantUser({ status: 'DEACTIVATED' }))

    await expect(
      handler(makeEvent({ email: 'gone@acme.com' }), fakeContext, fakeCallback),
    ).rejects.toThrow('deactivated')
  })

  // ── User not in roster ─────────────────────────────────────────────────────

  it('throws when user is not in the tenant roster', async () => {
    mockTenantFindFirst.mockResolvedValue({ id: 'tenant-uuid-123' })
    mockTenantUserFindUnique.mockResolvedValue(null)

    await expect(
      handler(makeEvent({ email: 'notinvited@acme.com' }), fakeContext, fakeCallback),
    ).rejects.toThrow('not been granted access')
  })

  // ── Tenant user path — failure cases ──────────────────────────────────────

  it('throws when no active tenant matches the email domain', async () => {
    mockTenantFindFirst.mockResolvedValue(null)

    await expect(
      handler(makeEvent({ email: 'user@unknown.com' }), fakeContext, fakeCallback),
    ).rejects.toThrow('not associated with any active Pegasus tenant')
  })

  it('throws when the email attribute is missing', async () => {
    await expect(handler(makeEvent({ groups: [] }), fakeContext, fakeCallback)).rejects.toThrow(
      'No email associated with identity',
    )
  })

  it('throws when the email has no @ character (invalid format)', async () => {
    await expect(
      handler(makeEvent({ email: 'notanemail' }), fakeContext, fakeCallback),
    ).rejects.toThrow('Invalid email format')
  })

  // ── AuthSession-based path ─────────────────────────────────────────────────

  it('uses AuthSession tenantId when a valid session exists', async () => {
    mockAuthSessionFindFirst.mockResolvedValue({
      id: 'session-uuid',
      tenantId: 'session-tenant-id',
      email: 'user@acme.com',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    mockTenantUserFindUnique.mockResolvedValue(activeTenantUser())

    const result = await handler(makeEvent({ email: 'user@acme.com' }), fakeContext, fakeCallback)

    const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride
    expect(claims?.['custom:tenantId']).toBe('session-tenant-id')
    // Domain lookup should NOT be called when AuthSession resolves the tenant
    expect(mockTenantFindFirst).not.toHaveBeenCalled()
  })

  it('queries AuthSession by email with expiresAt > now', async () => {
    mockAuthSessionFindFirst.mockResolvedValue({
      id: 'session-uuid',
      tenantId: 'session-tenant-id',
    })
    mockTenantUserFindUnique.mockResolvedValue(activeTenantUser())

    await handler(makeEvent({ email: 'user@acme.com' }), fakeContext, fakeCallback)

    expect(mockAuthSessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: 'user@acme.com',
          expiresAt: expect.objectContaining({ gt: expect.any(Date) }),
        }),
      }),
    )
  })

  it('deletes the consumed AuthSession after use (fire-and-forget)', async () => {
    mockAuthSessionFindFirst.mockResolvedValue({
      id: 'session-uuid',
      tenantId: 'session-tenant-id',
    })
    mockTenantUserFindUnique.mockResolvedValue(activeTenantUser())
    mockAuthSessionDeleteMany.mockResolvedValue({ count: 1 })

    await handler(makeEvent({ email: 'user@acme.com' }), fakeContext, fakeCallback)

    expect(mockAuthSessionDeleteMany).toHaveBeenCalledWith({
      where: { id: 'session-uuid' },
    })
  })

  it('falls back to domain lookup when no valid AuthSession found', async () => {
    mockAuthSessionFindFirst.mockResolvedValue(null)
    mockTenantFindFirst.mockResolvedValue({ id: 'domain-tenant-id' })
    mockTenantUserFindUnique.mockResolvedValue(activeTenantUser())

    const result = await handler(makeEvent({ email: 'user@acme.com' }), fakeContext, fakeCallback)

    expect(mockTenantFindFirst).toHaveBeenCalled()
    const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride
    expect(claims?.['custom:tenantId']).toBe('domain-tenant-id')
  })

  it('looks up TenantUser using AuthSession tenantId (not domain)', async () => {
    mockAuthSessionFindFirst.mockResolvedValue({
      id: 'session-uuid',
      tenantId: 'cross-org-tenant-id',
    })
    mockTenantUserFindUnique.mockResolvedValue(activeTenantUser())

    await handler(makeEvent({ email: 'contractor@external.com' }), fakeContext, fakeCallback)

    expect(mockTenantUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_email: { tenantId: 'cross-org-tenant-id', email: 'contractor@external.com' },
        },
      }),
    )
  })

  it('still blocks DEACTIVATED users even when AuthSession is present', async () => {
    mockAuthSessionFindFirst.mockResolvedValue({
      id: 'session-uuid',
      tenantId: 'tenant-uuid-123',
    })
    mockTenantUserFindUnique.mockResolvedValue(activeTenantUser({ status: 'DEACTIVATED' }))

    await expect(
      handler(makeEvent({ email: 'gone@acme.com' }), fakeContext, fakeCallback),
    ).rejects.toThrow('deactivated')
  })
})
