// ---------------------------------------------------------------------------
// Unit tests for the Cognito pre-token-generation Lambda trigger
//
// @prisma/client and @aws-sdk/client-ssm are fully mocked so tests run
// without any database connection or AWS credentials.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context } from 'aws-lambda'

// ---------------------------------------------------------------------------
// Hoisted constants and mocks — available inside vi.mock factories
// ---------------------------------------------------------------------------

const {
  ADMIN_CLIENT_ID,
  TENANT_CLIENT_ID,
  mockTenantUserFindMany,
  mockTenantUserFindFirst,
  mockTenantUserUpdate,
  mockAuthSessionFindFirst,
  mockAuthSessionDeleteMany,
  mockSsoProviderFindFirst,
} = vi.hoisted(() => ({
  ADMIN_CLIENT_ID: 'admin-client-id-test',
  TENANT_CLIENT_ID: 'tenant-client-id-test',
  mockTenantUserFindMany: vi.fn(),
  mockTenantUserFindFirst: vi.fn(),
  mockTenantUserUpdate: vi.fn(),
  mockAuthSessionFindFirst: vi.fn(),
  mockAuthSessionDeleteMany: vi.fn(),
  mockSsoProviderFindFirst: vi.fn(),
}))

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: vi.fn().mockImplementation(function () {
    return {}
  }),
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(function () {
    return {
      tenantUser: {
        findMany: mockTenantUserFindMany,
        findFirst: mockTenantUserFindFirst,
        update: mockTenantUserUpdate,
      },
      authSession: {
        findFirst: mockAuthSessionFindFirst,
        deleteMany: mockAuthSessionDeleteMany,
      },
      tenantSsoProvider: {
        findFirst: mockSsoProviderFindFirst,
      },
    }
  }),
}))

// ---------------------------------------------------------------------------
// SSM mock — returns ADMIN_CLIENT_ID for the well-known parameter name
// ---------------------------------------------------------------------------
vi.mock('@aws-sdk/client-ssm', () => {
  return {
    SSMClient: vi.fn().mockImplementation(function () {
      return {
        send: vi.fn().mockResolvedValue({
          Parameter: { Value: ADMIN_CLIENT_ID },
        }),
      }
    }),
    GetParameterCommand: vi.fn(),
  }
})

import { handler } from './pre-token'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeContext = {} as Context
const fakeCallback = () => undefined

/** Default group assigned to tenant users so they pass the no-groups guard. */
const TENANT_GROUP = 'us-east-1_test_tenant-uuid-123'

/**
 * Cognito's trigger source for a sign-in through the hosted UI — which, for a tenant app
 * client, only ever happens with an `identity_provider` hint, i.e. a real IdP round-trip.
 * A federated event carries THIS, not TokenGeneration_Authentication.
 */
const HOSTED_AUTH = 'TokenGeneration_HostedAuth'
/** Native username/password via InitiateAuth USER_PASSWORD_AUTH. */
const NATIVE_AUTH = 'TokenGeneration_Authentication'

/** Builds a minimal PreTokenGeneration trigger event. */
function makeEvent({
  email,
  sub,
  groups,
  clientId = TENANT_CLIENT_ID,
  identities,
  triggerSource = NATIVE_AUTH,
}: {
  email?: string
  sub?: string
  groups?: string[]
  clientId?: string
  /**
   * Raw value of the `identities` user attribute. Cognito delivers this as a JSON
   * STRING for users with a linked IdP identity and omits it entirely for purely-native
   * ones — pass a string to mimic the real shape, including deliberately malformed values.
   *
   * NOTE: presence does NOT imply the sign-in was federated. Account linking
   * (cognito/pre-sign-up.ts) attaches this to a NATIVE user permanently, so a password
   * login by a linked user carries it too — pair it with `triggerSource` to say which.
   */
  identities?: string
  /** How the token was requested. Drives native-vs-federated routing. */
  triggerSource?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): any {
  return {
    version: '1',
    triggerSource,
    region: 'us-east-1',
    userPoolId: 'us-east-1_test',
    callerContext: { awsSdkVersion: '1', clientId },
    userName: 'test-user',
    request: {
      userAttributes: {
        ...(email ? { email } : {}),
        ...(sub ? { sub } : {}),
        ...(identities !== undefined ? { identities } : {}),
      },
      groupConfiguration: {
        groupsToOverride: groups ?? [TENANT_GROUP],
        iamRolesToOverride: [],
        preferredRole: '',
      },
    },
    response: { claimsOverrideDetails: {} },
  }
}

/** A resolved ACTIVE TenantUser with USER role. */
function activeTenantUser(
  overrides?: Partial<{ role: string; status: string; roleNames: string[] }>,
) {
  return {
    id: 'user-uuid',
    role: 'USER',
    roleNames: ['viewer'],
    status: 'ACTIVE',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pre-token trigger', () => {
  beforeEach(() => {
    mockTenantUserFindMany.mockReset()
    mockTenantUserFindFirst.mockReset()
    mockTenantUserUpdate.mockReset()
    mockAuthSessionFindFirst.mockReset()
    mockAuthSessionDeleteMany.mockReset()
    mockSsoProviderFindFirst.mockReset()
    // Default: no auth session pending (most tests use the roster flow).
    mockAuthSessionFindFirst.mockResolvedValue(null)
    mockAuthSessionDeleteMany.mockResolvedValue({ count: 0 })
    // Default: a single roster row resolving to tenant-uuid-123.
    mockTenantUserFindMany.mockResolvedValue([{ tenantId: 'tenant-uuid-123' }])
    // Default: no SSO provider. Native logins must never reach this lookup.
    mockSsoProviderFindFirst.mockResolvedValue(null)
  })

  // ── Federated login: the provider determines the tenant ───────────────────
  //
  // An IdP can assert any `email` it likes — tenants configure their own IdPs into
  // a SHARED user pool. It cannot lie about which provider it is, because Cognito
  // stamps `providerName` from the pool's own registration, and we own the
  // provider→tenant mapping. So the provider, not the email, resolves the tenant.

  /** The `identities` attribute exactly as Cognito serialises it. */
  function identitiesAttr(providerName: string): string {
    return JSON.stringify([
      {
        userId: 'zSmI_AFcBNlAm5zlipPNBPbiy_Qui3uCDNpDDWIWn8M',
        providerName,
        providerType: 'OIDC',
        issuer: null,
        primary: 'true',
        dateCreated: '1700000000000',
      },
    ])
  }

  // Every event here carries HOSTED_AUTH: a federated sign-in reaches Cognito through the
  // hosted UI, so that is what the real trigger event looks like. `identities` alone does
  // not make a login federated — a linked user carries it on password logins too.
  describe('federated login — provider/tenant binding', () => {
    it('resolves the tenant from the provider, not the email roster', async () => {
      mockSsoProviderFindFirst.mockResolvedValue({
        tenantId: 'tenant-from-provider',
        isEnabled: true,
      })
      mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

      const event = await handler(
        makeEvent({
          email: 'user@example.com',
          sub: 'x',
          identities: identitiesAttr('AcmeOkta'),
          triggerSource: HOSTED_AUTH,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (() => {}) as any,
      )

      expect(mockSsoProviderFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ cognitoProviderName: 'AcmeOkta' }),
        }),
      )
      // The roster must NOT be consulted to resolve the tenant.
      expect(mockTenantUserFindMany).not.toHaveBeenCalled()
      expect(mockTenantUserFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-from-provider' }),
        }),
      )
      expect(event?.response.claimsOverrideDetails.claimsToAddOrOverride['custom:tenantId']).toBe(
        'tenant-from-provider',
      )
    })

    // THE escalation, as a regression test. Tenant B owns the provider; the asserted
    // email is rostered only in tenant A. Tenant A's claims must never be issued.
    it('never issues another tenant claims when its provider asserts that tenants email', async () => {
      mockSsoProviderFindFirst.mockResolvedValue({ tenantId: 'tenant-B', isEnabled: true })
      // Tenant B has no roster row for the victim's email.
      mockTenantUserFindFirst.mockResolvedValue(null)

      await expect(
        handler(
          makeEvent({
            email: 'admin@tenant-a.example',
            sub: 'x',
            identities: identitiesAttr('TenantBEvil'),
            triggerSource: HOSTED_AUTH,
          }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {} as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (() => {}) as any,
        ),
      ).rejects.toThrow()

      // Resolution was anchored to tenant B — tenant A was never even looked up.
      expect(mockTenantUserFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-B' }) }),
      )
      expect(mockTenantUserFindMany).not.toHaveBeenCalled()
    })

    it('denies an unknown provider', async () => {
      mockSsoProviderFindFirst.mockResolvedValue(null)

      await expect(
        handler(
          makeEvent({
            email: 'a@b.com',
            sub: 'x',
            identities: identitiesAttr('GhostProvider'),
            triggerSource: HOSTED_AUTH,
          }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {} as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (() => {}) as any,
        ),
      ).rejects.toThrow()
    })

    it('denies a disabled provider', async () => {
      mockSsoProviderFindFirst.mockResolvedValue({ tenantId: 'tenant-x', isEnabled: false })

      await expect(
        handler(
          makeEvent({
            email: 'a@b.com',
            sub: 'x',
            identities: identitiesAttr('DisabledIdp'),
            triggerSource: HOSTED_AUTH,
          }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {} as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (() => {}) as any,
        ),
      ).rejects.toThrow()
    })

    // The login flow only ever routes a user to their selected tenant's own provider,
    // so a disagreement is an attack signal or a serious bug. Fail closed.
    it('denies when a pending AuthSession names a different tenant than the provider', async () => {
      mockAuthSessionFindFirst.mockResolvedValue({ id: 's1', tenantId: 'tenant-A' })
      mockSsoProviderFindFirst.mockResolvedValue({ tenantId: 'tenant-B', isEnabled: true })

      await expect(
        handler(
          makeEvent({
            email: 'a@b.com',
            sub: 'x',
            identities: identitiesAttr('TenantBIdp'),
            triggerSource: HOSTED_AUTH,
          }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {} as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (() => {}) as any,
        ),
      ).rejects.toThrow()

      expect(mockTenantUserFindFirst).not.toHaveBeenCalled()
    })

    it('allows when a pending AuthSession agrees with the provider', async () => {
      mockAuthSessionFindFirst.mockResolvedValue({ id: 's1', tenantId: 'tenant-agreed' })
      mockSsoProviderFindFirst.mockResolvedValue({ tenantId: 'tenant-agreed', isEnabled: true })
      mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

      const event = await handler(
        makeEvent({
          email: 'a@b.com',
          sub: 'x',
          identities: identitiesAttr('GoodIdp'),
          triggerSource: HOSTED_AUTH,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (() => {}) as any,
      )

      expect(event?.response.claimsOverrideDetails.claimsToAddOrOverride['custom:tenantId']).toBe(
        'tenant-agreed',
      )
    })

    // Never treat an unparseable claim as trusted federation — fall back to the
    // native path, which is strictly more restrictive.
    it.each([
      ['malformed JSON', 'not-json-at-all'],
      ['empty array', '[]'],
      ['array of junk', '[{"noProviderName":true}]'],
      ['empty string', ''],
    ])('treats %s identities as a native login', async (_label, identities) => {
      mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

      const event = await handler(
        makeEvent({ email: 'a@b.com', sub: 'x', identities }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (() => {}) as any,
      )

      // Native path: roster resolution ran, provider lookup did not.
      expect(mockSsoProviderFindFirst).not.toHaveBeenCalled()
      expect(mockTenantUserFindMany).toHaveBeenCalled()
      expect(event?.response.claimsOverrideDetails.claimsToAddOrOverride['custom:tenantId']).toBe(
        'tenant-uuid-123',
      )
    })

    it('does not look up a provider for a native login', async () => {
      mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

      await handler(
        makeEvent({ email: 'a@b.com', sub: 'x' }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (() => {}) as any,
      )

      expect(mockSsoProviderFindFirst).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // A LINKED user — `identities` present AND authenticating natively.
  //
  // This combination was impossible until account linking (cognito/pre-sign-up.ts)
  // started attaching a federated identity to a person's native user, so nothing
  // covered it — which is exactly how the break below reached production: every
  // password login by a linked user was routed as federated, pinned to the provider's
  // tenant, and any other tenant pick died on the disagreement check.
  // -------------------------------------------------------------------------
  describe('linked user — a native login is not a federated login', () => {
    it('resolves the AuthSession tenant on a password login, even though identities is present', async () => {
      // THE prod regression: a user rostered in several tenants, linked to tenant-B's
      // IdP, signing in with a password and picking tenant-A.
      mockAuthSessionFindFirst.mockResolvedValue({ id: 's1', tenantId: 'tenant-A' })
      mockSsoProviderFindFirst.mockResolvedValue({ tenantId: 'tenant-B', isEnabled: true })
      mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

      const event = await handler(
        makeEvent({
          email: 'multi@example.com',
          sub: 'x',
          identities: identitiesAttr('TenantBIdp'),
          triggerSource: NATIVE_AUTH,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (() => {}) as any,
      )

      // The provider must not be consulted at all — this sign-in never touched an IdP.
      expect(mockSsoProviderFindFirst).not.toHaveBeenCalled()
      expect(event?.response.claimsOverrideDetails.claimsToAddOrOverride['custom:tenantId']).toBe(
        'tenant-A',
      )
    })

    it('does not throw when the AuthSession tenant differs from the linked provider tenant', async () => {
      // The disagreement guard belongs to federated sign-ins only. On a password login
      // there is no provider assertion to disagree with, and throwing here is what locked
      // a multi-tenant SSO user out of every tenant but their provider's.
      mockAuthSessionFindFirst.mockResolvedValue({ id: 's1', tenantId: 'tenant-A' })
      mockSsoProviderFindFirst.mockResolvedValue({ tenantId: 'tenant-B', isEnabled: true })
      mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

      await expect(
        handler(
          makeEvent({
            email: 'multi@example.com',
            sub: 'x',
            identities: identitiesAttr('TenantBIdp'),
            triggerSource: NATIVE_AUTH,
          }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {} as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (() => {}) as any,
        ),
      ).resolves.toBeDefined()
    })

    it('still routes the same linked user through the provider when they use SSO', async () => {
      // The other half of the contract: linking must not cost us the #443 binding.
      mockAuthSessionFindFirst.mockResolvedValue(null)
      mockSsoProviderFindFirst.mockResolvedValue({ tenantId: 'tenant-B', isEnabled: true })
      mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

      const event = await handler(
        makeEvent({
          email: 'multi@example.com',
          sub: 'x',
          identities: identitiesAttr('TenantBIdp'),
          triggerSource: HOSTED_AUTH,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (() => {}) as any,
      )

      expect(mockSsoProviderFindFirst).toHaveBeenCalled()
      expect(event?.response.claimsOverrideDetails.claimsToAddOrOverride['custom:tenantId']).toBe(
        'tenant-B',
      )
    })

    it('treats a temporary-password challenge as native for a linked user', async () => {
      // TokenGeneration_NewPasswordChallenge is an invited user's first sign-in. It is a
      // native flow and must not be pinned to a linked provider's tenant.
      mockAuthSessionFindFirst.mockResolvedValue({ id: 's1', tenantId: 'tenant-A' })
      mockSsoProviderFindFirst.mockResolvedValue({ tenantId: 'tenant-B', isEnabled: true })
      mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

      const event = await handler(
        makeEvent({
          email: 'multi@example.com',
          sub: 'x',
          identities: identitiesAttr('TenantBIdp'),
          triggerSource: 'TokenGeneration_NewPasswordChallenge',
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (() => {}) as any,
      )

      expect(mockSsoProviderFindFirst).not.toHaveBeenCalled()
      expect(event?.response.claimsOverrideDetails.claimsToAddOrOverride['custom:tenantId']).toBe(
        'tenant-A',
      )
    })

    it('does not treat hosted-UI auth without any linked identity as federated', async () => {
      // Defensive: no provider name means there is nothing to resolve a tenant from, so
      // the native path (stricter) must handle it regardless of trigger source.
      mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

      await handler(
        makeEvent({ email: 'a@b.com', sub: 'x', triggerSource: HOSTED_AUTH }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (() => {}) as any,
      )

      expect(mockSsoProviderFindFirst).not.toHaveBeenCalled()
    })
  })

  // ── Admin app client path ─────────────────────────────────────────────────

  it('emits no custom claims for admin app client (admin gating uses cognito:groups directly)', async () => {
    const event = makeEvent({
      email: 'admin@pegasus.com',
      groups: ['PLATFORM_ADMIN'],
      clientId: ADMIN_CLIENT_ID,
    })
    const result = await handler(event, fakeContext, fakeCallback)

    expect(result.response.claimsOverrideDetails?.claimsToAddOrOverride).toBeUndefined()
  })

  it('skips all DB lookups for admin app client', async () => {
    const event = makeEvent({
      email: 'admin@pegasus.com',
      groups: ['PLATFORM_ADMIN'],
      clientId: ADMIN_CLIENT_ID,
    })
    await handler(event, fakeContext, fakeCallback)

    expect(mockTenantUserFindMany).not.toHaveBeenCalled()
    expect(mockTenantUserFindFirst).not.toHaveBeenCalled()
    expect(mockAuthSessionFindFirst).not.toHaveBeenCalled()
  })

  it('admin client emits no claims regardless of group membership', async () => {
    const event = makeEvent({
      email: 'admin@pegasus.com',
      groups: [TENANT_GROUP],
      clientId: ADMIN_CLIENT_ID,
    })
    const result = await handler(event, fakeContext, fakeCallback)

    expect(result.response.claimsOverrideDetails?.claimsToAddOrOverride).toBeUndefined()
  })

  // ── Platform admin logging into tenant app ────────────────────────────────

  it('resolves tenant claims when platform admin uses tenant app client', async () => {
    mockTenantUserFindFirst.mockResolvedValue(
      activeTenantUser({ roleNames: ['tenant_admin'], status: 'ACTIVE' }),
    )

    const event = makeEvent({
      email: 'admin@acme.com',
      groups: ['PLATFORM_ADMIN'],
      clientId: TENANT_CLIENT_ID,
    })
    const result = await handler(event, fakeContext, fakeCallback)

    const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride
    expect(claims?.['custom:tenantId']).toBe('tenant-uuid-123')
    expect(claims?.['custom:roles']).toBe(JSON.stringify(['tenant_admin']))
  })

  // ── No-group admin users (admin setup flow) ────────────────────────────────

  it('returns event without custom claims when admin user has no groups', async () => {
    const event = makeEvent({
      email: 'newadmin@pegasus.com',
      groups: [],
      clientId: ADMIN_CLIENT_ID,
    })
    const result = await handler(event, fakeContext, fakeCallback)

    expect(result.response.claimsOverrideDetails?.claimsToAddOrOverride).toBeUndefined()
    expect(mockTenantUserFindMany).not.toHaveBeenCalled()
    expect(mockTenantUserFindFirst).not.toHaveBeenCalled()
  })

  it('returns event without custom claims when admin groupsToOverride is undefined', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const event = makeEvent({ email: 'newadmin@pegasus.com', clientId: ADMIN_CLIENT_ID }) as any
    event.request.groupConfiguration.groupsToOverride = undefined
    const result = await handler(event, fakeContext, fakeCallback)

    expect(result.response.claimsOverrideDetails?.claimsToAddOrOverride).toBeUndefined()
  })

  // ── Tenant user with no groups proceeds to tenant resolution ──────────────

  it('resolves tenant claims for tenant user with no groups', async () => {
    mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

    const event = makeEvent({ email: 'user@acme.com', groups: [] })
    const result = await handler(event, fakeContext, fakeCallback)

    const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride
    expect(claims?.['custom:tenantId']).toBe('tenant-uuid-123')
    expect(claims?.['custom:roles']).toBe(JSON.stringify(['viewer']))
  })

  // ── Tenant app client — happy path (ACTIVE user) ─────────────────────────

  it('injects custom:tenantId and custom:roles for an ACTIVE tenant_user', async () => {
    mockTenantUserFindFirst.mockResolvedValue(
      activeTenantUser({ roleNames: ['viewer'], status: 'ACTIVE' }),
    )

    const result = await handler(makeEvent({ email: 'user@acme.com' }), fakeContext, fakeCallback)

    const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride
    expect(claims?.['custom:tenantId']).toBe('tenant-uuid-123')
    expect(claims?.['custom:roles']).toBe(JSON.stringify(['viewer']))
  })

  it('injects custom:roles=[tenant_admin] for an ACTIVE tenant_admin', async () => {
    mockTenantUserFindFirst.mockResolvedValue(
      activeTenantUser({ roleNames: ['tenant_admin'], status: 'ACTIVE' }),
    )

    const result = await handler(makeEvent({ email: 'admin@acme.com' }), fakeContext, fakeCallback)

    const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride
    expect(claims?.['custom:roles']).toBe(JSON.stringify(['tenant_admin']))
  })

  // ── Roster-based tenant resolution (no AuthSession) ───────────────────────

  it('resolves the tenant from a single roster row when there is no AuthSession', async () => {
    mockTenantUserFindMany.mockResolvedValue([{ tenantId: 'roster-tenant-id' }])
    mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

    const result = await handler(makeEvent({ email: 'user@acme.com' }), fakeContext, fakeCallback)

    const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride
    expect(claims?.['custom:tenantId']).toBe('roster-tenant-id')
  })

  it('queries the roster by email, excluding DEACTIVATED rows and inactive tenants', async () => {
    mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

    await handler(makeEvent({ email: 'user@acme.com' }), fakeContext, fakeCallback)

    expect(mockTenantUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: { equals: 'user@acme.com', mode: 'insensitive' },
          status: { not: 'DEACTIVATED' },
          tenant: { status: 'ACTIVE' },
        }),
      }),
    )
  })

  it('lowercases the email before the roster lookup', async () => {
    mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

    await handler(makeEvent({ email: 'User@ACME.COM' }), fakeContext, fakeCallback)

    expect(mockTenantUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: { equals: 'user@acme.com', mode: 'insensitive' },
        }),
      }),
    )
  })

  it('throws session-expired when the roster has multiple rows and there is no AuthSession', async () => {
    mockTenantUserFindMany.mockResolvedValue([{ tenantId: 'tenant-a' }, { tenantId: 'tenant-b' }])

    await expect(
      handler(makeEvent({ email: 'multi@acme.com' }), fakeContext, fakeCallback),
    ).rejects.toThrow('Your session has expired. Please sign in again.')
  })

  it('throws not-granted-access when there is no roster row and no AuthSession', async () => {
    mockTenantUserFindMany.mockResolvedValue([])

    await expect(
      handler(makeEvent({ email: 'user@unknown.com' }), fakeContext, fakeCallback),
    ).rejects.toThrow('not been granted access')
  })

  // ── PENDING user — first login ─────────────────────────────────────────────

  it('activates a PENDING user on first login and injects their roleNames', async () => {
    mockTenantUserFindFirst.mockResolvedValue({
      id: 'user-uuid',
      roleNames: ['tenant_admin'],
      status: 'PENDING',
    })
    mockTenantUserUpdate.mockResolvedValue({})

    const result = await handler(
      makeEvent({ email: 'new@acme.com', sub: 'cognito-sub-abc' }),
      fakeContext,
      fakeCallback,
    )

    const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride
    expect(claims?.['custom:roles']).toBe(JSON.stringify(['tenant_admin']))
    expect(mockTenantUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-uuid' },
        data: expect.objectContaining({ status: 'ACTIVE', cognitoSub: 'cognito-sub-abc' }),
      }),
    )
  })

  // ── DEACTIVATED user ───────────────────────────────────────────────────────

  it('throws for a DEACTIVATED user', async () => {
    mockTenantUserFindFirst.mockResolvedValue(activeTenantUser({ status: 'DEACTIVATED' }))

    await expect(
      handler(makeEvent({ email: 'gone@acme.com' }), fakeContext, fakeCallback),
    ).rejects.toThrow('deactivated')
  })

  // ── User resolved a tenant but has no roster entry ────────────────────────

  it('throws when the resolved tenant has no roster entry for the user', async () => {
    mockAuthSessionFindFirst.mockResolvedValue({
      id: 'session-uuid',
      tenantId: 'tenant-uuid-123',
    })
    mockTenantUserFindFirst.mockResolvedValue(null)

    await expect(
      handler(makeEvent({ email: 'notinvited@acme.com' }), fakeContext, fakeCallback),
    ).rejects.toThrow('not been granted access')
  })

  it('throws when the email attribute is missing', async () => {
    await expect(
      handler(makeEvent({ groups: [TENANT_GROUP] }), fakeContext, fakeCallback),
    ).rejects.toThrow('No email associated with identity')
  })

  // ── AuthSession-based path ─────────────────────────────────────────────────

  it('uses AuthSession tenantId when a valid session exists', async () => {
    mockAuthSessionFindFirst.mockResolvedValue({
      id: 'session-uuid',
      tenantId: 'session-tenant-id',
      email: 'user@acme.com',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

    const result = await handler(makeEvent({ email: 'user@acme.com' }), fakeContext, fakeCallback)

    const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride
    expect(claims?.['custom:tenantId']).toBe('session-tenant-id')
    // The roster lookup should NOT run when an AuthSession resolves the tenant.
    expect(mockTenantUserFindMany).not.toHaveBeenCalled()
  })

  it('queries AuthSession by email with expiresAt > now', async () => {
    mockAuthSessionFindFirst.mockResolvedValue({
      id: 'session-uuid',
      tenantId: 'session-tenant-id',
    })
    mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

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

  it('does NOT delete the AuthSession on read — it must survive the multi-invocation login burst', async () => {
    mockAuthSessionFindFirst.mockResolvedValue({
      id: 'session-uuid',
      tenantId: 'session-tenant-id',
    })
    mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

    await handler(makeEvent({ email: 'user@acme.com' }), fakeContext, fakeCallback)

    // deleteMany is only ever called to sweep expired rows (expiresAt < now),
    // never to consume the session that was just read by id.
    expect(mockAuthSessionDeleteMany).not.toHaveBeenCalledWith({
      where: { id: 'session-uuid' },
    })
  })

  it('sweeps expired AuthSession rows on every tenant-client invocation', async () => {
    mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

    await handler(makeEvent({ email: 'user@acme.com' }), fakeContext, fakeCallback)

    expect(mockAuthSessionDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { expiresAt: { lt: expect.any(Date) } },
      }),
    )
  })

  it('falls back to the roster lookup when no valid AuthSession is found', async () => {
    mockAuthSessionFindFirst.mockResolvedValue(null)
    mockTenantUserFindMany.mockResolvedValue([{ tenantId: 'roster-tenant-id' }])
    mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

    const result = await handler(makeEvent({ email: 'user@acme.com' }), fakeContext, fakeCallback)

    expect(mockTenantUserFindMany).toHaveBeenCalled()
    const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride
    expect(claims?.['custom:tenantId']).toBe('roster-tenant-id')
  })

  it('looks up TenantUser using AuthSession tenantId (not the roster resolution)', async () => {
    mockAuthSessionFindFirst.mockResolvedValue({
      id: 'session-uuid',
      tenantId: 'cross-org-tenant-id',
    })
    mockTenantUserFindFirst.mockResolvedValue(activeTenantUser())

    await handler(makeEvent({ email: 'contractor@external.com' }), fakeContext, fakeCallback)

    expect(mockTenantUserFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'cross-org-tenant-id',
          email: { equals: 'contractor@external.com', mode: 'insensitive' },
        },
      }),
    )
  })

  // ── custom:roles emission (Cedar role-group memberships) ─────────────────

  it('emits custom:roles JSON-encoded from tenantUser.roleNames when populated', async () => {
    mockTenantUserFindFirst.mockResolvedValue(
      activeTenantUser({ role: 'USER', roleNames: ['local_dispatch', 'viewer'] }),
    )

    const result = await handler(
      makeEvent({ email: 'dispatch@acme.com' }),
      fakeContext,
      fakeCallback,
    )

    const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride
    expect(claims?.['custom:roles']).toBe(JSON.stringify(['local_dispatch', 'viewer']))
  })

  // Mirrors `custom:roles` into `cognito:groups` so AVP's Cognito identity
  // source (configured with groupConfiguration.groupEntityType =
  // Pegasus::Group) can synthesize `principal in Pegasus::Group::"X"`
  // memberships automatically. Without the override, AVP sees the principal
  // as a bare User with no parents and every group-gated permit evaluates
  // to false (empty /me/permissions, blanket 403).
  it('emits cognito:groups via groupOverrideDetails matching Cedar roles', async () => {
    mockTenantUserFindFirst.mockResolvedValue(
      activeTenantUser({ role: 'USER', roleNames: ['local_dispatch', 'viewer'] }),
    )

    const result = await handler(
      makeEvent({ email: 'dispatch@acme.com' }),
      fakeContext,
      fakeCallback,
    )

    const groupOverride = result.response.claimsOverrideDetails?.groupOverrideDetails
    expect(groupOverride?.groupsToOverride).toEqual(['local_dispatch', 'viewer'])
  })

  it('emits empty custom:roles when roleNames is empty (fail-closed at permission layer)', async () => {
    mockTenantUserFindFirst.mockResolvedValue(activeTenantUser({ roleNames: [] }))

    const result = await handler(makeEvent({ email: 'admin@acme.com' }), fakeContext, fakeCallback)

    const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride
    expect(claims?.['custom:roles']).toBe(JSON.stringify([]))
    const groupOverride = result.response.claimsOverrideDetails?.groupOverrideDetails
    expect(groupOverride?.groupsToOverride).toEqual([])
  })

  it('still blocks DEACTIVATED users even when AuthSession is present', async () => {
    mockAuthSessionFindFirst.mockResolvedValue({
      id: 'session-uuid',
      tenantId: 'tenant-uuid-123',
    })
    mockTenantUserFindFirst.mockResolvedValue(activeTenantUser({ status: 'DEACTIVATED' }))

    await expect(
      handler(makeEvent({ email: 'gone@acme.com' }), fakeContext, fakeCallback),
    ).rejects.toThrow('deactivated')
  })
})
