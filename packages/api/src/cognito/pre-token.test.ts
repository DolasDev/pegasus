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

const { mockTenantFindFirst, mockTenantUserFindUnique, mockTenantUserUpdate } = vi.hoisted(() => ({
  mockTenantFindFirst: vi.fn(),
  mockTenantUserFindUnique: vi.fn(),
  mockTenantUserUpdate: vi.fn(),
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    tenant: { findFirst: mockTenantFindFirst },
    tenantUser: {
      findUnique: mockTenantUserFindUnique,
      update: mockTenantUserUpdate,
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeEvent({ email, sub, groups = [] }: { email?: string; sub?: string; groups?: string[] }): any {
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
    mockTenantUserFindUnique.mockResolvedValue(activeTenantUser({ role: 'ADMIN', status: 'ACTIVE' }))

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
    mockTenantUserFindUnique.mockResolvedValue({ id: 'user-uuid', role: 'ADMIN', status: 'PENDING' })
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
    await expect(
      handler(makeEvent({ groups: [] }), fakeContext, fakeCallback),
    ).rejects.toThrow('No email associated with identity')
  })

  it('throws when the email has no @ character (invalid format)', async () => {
    await expect(
      handler(makeEvent({ email: 'notanemail' }), fakeContext, fakeCallback),
    ).rejects.toThrow('Invalid email format')
  })
})
