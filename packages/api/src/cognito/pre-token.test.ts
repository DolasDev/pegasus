// ---------------------------------------------------------------------------
// Unit tests for the Cognito pre-token-generation Lambda trigger
//
// @prisma/client is fully mocked so tests run without any database connection.
// PrismaClient is constructed at module level in pre-token.ts, so vi.hoisted()
// is used to ensure the mock findFirst function is available before the factory
// runs and the module is imported.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context } from 'aws-lambda'

// ---------------------------------------------------------------------------
// Prisma mock — hoisted so the fn is available inside the vi.mock factory
// ---------------------------------------------------------------------------

const { mockFindFirst } = vi.hoisted(() => ({ mockFindFirst: vi.fn() }))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    tenant: { findFirst: mockFindFirst },
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
  groups = [],
}: {
  email?: string
  groups?: string[]
}) {
  return {
    version: '1',
    triggerSource: 'TokenGeneration_Authentication' as const,
    region: 'us-east-1',
    userPoolId: 'us-east-1_test',
    callerContext: { awsSdkVersion: '1', clientId: 'test-client' },
    userName: 'test-user',
    request: {
      userAttributes: email ? { email } : {},
      groupConfiguration: { groupsToOverride: groups, iamRolesToOverride: [], preferredRole: '' },
    },
    response: {},
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pre-token trigger', () => {
  beforeEach(() => {
    mockFindFirst.mockReset()
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

    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  // ── Tenant user path — happy path ─────────────────────────────────────────

  it('injects custom:tenantId and custom:role=tenant_user for a matched tenant user', async () => {
    mockFindFirst.mockResolvedValue({ id: 'tenant-uuid-123' })

    const event = makeEvent({ email: 'user@acme.com', groups: [] })
    const result = await handler(event, fakeContext, fakeCallback)

    const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride
    expect(claims?.['custom:tenantId']).toBe('tenant-uuid-123')
    expect(claims?.['custom:role']).toBe('tenant_user')
  })

  it('queries the DB with the email domain and status ACTIVE', async () => {
    mockFindFirst.mockResolvedValue({ id: 'tenant-uuid-123' })

    await handler(makeEvent({ email: 'user@acme.com' }), fakeContext, fakeCallback)

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          emailDomains: { has: 'acme.com' },
          status: 'ACTIVE',
        }),
      }),
    )
  })

  it('lowercases the email domain before querying', async () => {
    mockFindFirst.mockResolvedValue({ id: 'tenant-uuid-123' })

    await handler(makeEvent({ email: 'User@ACME.COM' }), fakeContext, fakeCallback)

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ emailDomains: { has: 'acme.com' } }),
      }),
    )
  })

  // ── Tenant user path — failure cases ──────────────────────────────────────

  it('throws when no active tenant matches the email domain', async () => {
    mockFindFirst.mockResolvedValue(null)

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
