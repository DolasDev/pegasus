// ---------------------------------------------------------------------------
// Unit tests for the Cognito pre-sign-up Lambda trigger
//
// @prisma/client and @aws-sdk/client-cognito-identity-provider are fully mocked
// so tests run without any database connection or AWS credentials.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context } from 'aws-lambda'

// ---------------------------------------------------------------------------
// Hoisted constants and mocks — available inside vi.mock factories
// ---------------------------------------------------------------------------

const { mockSsoProviderFindMany, mockTenantUserFindFirst, mockCognitoSend } = vi.hoisted(() => ({
  mockSsoProviderFindMany: vi.fn(),
  mockTenantUserFindFirst: vi.fn(),
  mockCognitoSend: vi.fn(),
}))

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: vi.fn().mockImplementation(function () {
    return {}
  }),
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(function () {
    return {
      tenantSsoProvider: { findMany: mockSsoProviderFindMany },
      tenantUser: { findFirst: mockTenantUserFindFirst },
    }
  }),
}))

// Command constructors are mocked as identity-ish carriers so assertions can
// read the input back off the object handed to send().
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn().mockImplementation(function () {
    return { send: mockCognitoSend }
  }),
  ListUsersCommand: vi.fn().mockImplementation(function (input: unknown) {
    return { __type: 'ListUsers', input }
  }),
  AdminLinkProviderForUserCommand: vi.fn().mockImplementation(function (input: unknown) {
    return { __type: 'AdminLinkProviderForUser', input }
  }),
}))

import { handler, providerNameCandidates, isAlreadyLinkedError } from './pre-sign-up'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeContext = {} as Context
const fakeCallback = () => undefined

const POOL_ID = 'us-east-1_test'
const TENANT_ID = 'tenant-uuid-1'
const OTHER_TENANT_ID = 'tenant-uuid-2'
const EMAIL = 'user@example.com'
/** The pool's generated UUID Username for the native user — NOT the email. */
const NATIVE_USERNAME = 'd4788428-1051-70d7-f058-5b66c972eefc'

/** Builds a minimal PreSignUp trigger event. */
function makeEvent({
  triggerSource = 'PreSignUp_ExternalProvider',
  userName = `Microsoft_zSmI_AFcBNlAm5zli`,
  email = EMAIL,
  userPoolId = POOL_ID,
}: {
  triggerSource?: string
  userName?: string
  email?: string
  userPoolId?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} = {}): any {
  return {
    version: '1',
    triggerSource,
    region: 'us-east-1',
    userPoolId,
    callerContext: { awsSdkVersion: '1', clientId: 'client-id' },
    userName,
    request: {
      userAttributes: { ...(email ? { email } : {}) },
    },
    response: { autoConfirmUser: false, autoVerifyEmail: false, autoVerifyPhone: false },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (event: any) => handler(event, fakeContext, fakeCallback) as Promise<unknown>

/** The AdminLinkProviderForUser call, if one was made. */
function linkCall() {
  return mockCognitoSend.mock.calls
    .map(([cmd]) => cmd as { __type: string; input: Record<string, unknown> })
    .find((cmd) => cmd.__type === 'AdminLinkProviderForUser')
}

function enabledProvider(overrides?: Record<string, unknown>) {
  return {
    tenantId: TENANT_ID,
    cognitoProviderName: 'Microsoft',
    isEnabled: true,
    ...overrides,
  }
}

/** A ListUsers row in the real shape — email lives in Attributes, not at the top level. */
function cognitoUser({
  username = NATIVE_USERNAME,
  email = EMAIL,
  status = 'CONFIRMED',
}: { username?: string; email?: string; status?: string } = {}) {
  return {
    Username: username,
    UserStatus: status,
    Attributes: [
      { Name: 'sub', Value: 'sub-value' },
      { Name: 'email', Value: email },
    ],
  }
}

/** ListUsers → one native user; AdminLinkProviderForUser → success. */
function happyCognito(users = [cognitoUser()]) {
  mockCognitoSend.mockImplementation(async (cmd: { __type: string }) => {
    if (cmd.__type === 'ListUsers') {
      return { Users: users }
    }
    return {}
  })
}

/** The ListUsers call, if one was made. */
function listCall() {
  return mockCognitoSend.mock.calls
    .map(([cmd]) => cmd as { __type: string; input: Record<string, unknown> })
    .find((cmd) => cmd.__type === 'ListUsers')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('providerNameCandidates', () => {
  it('offers every underscore boundary as a possible provider/sub split', () => {
    // Provider names may contain underscores and so may Entra subs, so the
    // boundary cannot be inferred from the string alone — every one is a candidate.
    expect(providerNameCandidates('Acme_Okta_123')).toEqual(['Acme', 'Acme_Okta'])
  })

  it('returns no candidates when there is no usable boundary', () => {
    expect(providerNameCandidates('NoUnderscore')).toEqual([])
    // A trailing underscore would leave an empty sub — not a real boundary.
    expect(providerNameCandidates('Trailing_')).toEqual([])
    expect(providerNameCandidates('_Leading')).toEqual([])
  })
})

describe('isAlreadyLinkedError', () => {
  it('recognises the Cognito already-linked message', () => {
    expect(isAlreadyLinkedError(new Error('SourceUser is already linked to DestinationUser'))).toBe(
      true,
    )
  })

  it('matches regardless of case and surrounding text', () => {
    expect(
      isAlreadyLinkedError(
        new Error('InvalidParameterException: already linked to destinationuser'),
      ),
    ).toBe(true)
  })

  it('does not match unrelated link failures', () => {
    expect(isAlreadyLinkedError(new Error('AliasExistsException'))).toBe(false)
    expect(isAlreadyLinkedError(new Error('cognito is down'))).toBe(false)
  })

  it('handles a non-Error thrown value without throwing', () => {
    expect(isAlreadyLinkedError('already linked to DestinationUser')).toBe(true)
    expect(isAlreadyLinkedError(undefined)).toBe(false)
    expect(isAlreadyLinkedError(null)).toBe(false)
  })
})

describe('pre-sign-up trigger', () => {
  beforeEach(() => {
    mockSsoProviderFindMany.mockReset()
    mockTenantUserFindFirst.mockReset()
    mockCognitoSend.mockReset()
  })

  // -------------------------------------------------------------------------
  // The happy path
  // -------------------------------------------------------------------------

  it('links a same-tenant roster match to the native user', async () => {
    mockSsoProviderFindMany.mockResolvedValue([enabledProvider()])
    mockTenantUserFindFirst.mockResolvedValue({ id: 'tenant-user-1' })
    happyCognito()

    const event = makeEvent()
    const result = await invoke(event)

    const call = linkCall()
    expect(call).toBeDefined()
    expect(call!.input).toEqual({
      UserPoolId: POOL_ID,
      DestinationUser: {
        ProviderName: 'Cognito',
        // The pool's UUID Username, NOT the email — email is only an attribute
        // because UsernameAttributes: ["email"] generates a UUID username.
        ProviderAttributeValue: NATIVE_USERNAME,
      },
      SourceUser: {
        ProviderName: 'Microsoft',
        ProviderAttributeName: 'email',
        ProviderAttributeValue: EMAIL,
      },
    })
    expect(result).toBe(event)
  })

  it('resolves the provider by database match, not by splitting on the first underscore', async () => {
    // userName = `Acme_Okta_<sub>`; the registered provider is `Acme_Okta`, so a
    // first-underscore split would look up `Acme` and miss (or worse, hit another
    // tenant's provider of that name).
    mockSsoProviderFindMany.mockResolvedValue([
      enabledProvider({ cognitoProviderName: 'Acme_Okta' }),
    ])
    mockTenantUserFindFirst.mockResolvedValue({ id: 'tenant-user-1' })
    happyCognito()

    await invoke(makeEvent({ userName: 'Acme_Okta_sub_123' }))

    expect(mockSsoProviderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cognitoProviderName: { in: ['Acme', 'Acme_Okta', 'Acme_Okta_sub'] } },
      }),
    )
    expect(linkCall()!.input).toMatchObject({
      SourceUser: expect.objectContaining({ ProviderName: 'Acme_Okta' }),
    })
  })

  // -------------------------------------------------------------------------
  // The trust boundary — never link outside the provider's own tenant
  // -------------------------------------------------------------------------

  it('does NOT link an email rostered only in another tenant', async () => {
    mockSsoProviderFindMany.mockResolvedValue([enabledProvider()])
    // Roster lookup is scoped to the provider's tenant, so it finds nothing.
    mockTenantUserFindFirst.mockResolvedValue(null)
    happyCognito()

    const event = makeEvent()
    const result = await invoke(event)

    expect(mockTenantUserFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT_ID }) }),
    )
    expect(linkCall()).toBeUndefined()
    expect(result).toBe(event)
  })

  it('does NOT link when the userName matches providers in multiple tenants', async () => {
    // `Acme_Okta_123` is a valid userName for a provider named `Acme` AND for one
    // named `Acme_Okta`. Guessing could link a stranger into someone else's
    // tenant — the escalation PR #443 closed. Refuse instead.
    mockSsoProviderFindMany.mockResolvedValue([
      enabledProvider({ cognitoProviderName: 'Acme' }),
      enabledProvider({ cognitoProviderName: 'Acme_Okta', tenantId: OTHER_TENANT_ID }),
    ])
    happyCognito()

    await invoke(makeEvent({ userName: 'Acme_Okta_123' }))

    expect(linkCall()).toBeUndefined()
    expect(mockTenantUserFindFirst).not.toHaveBeenCalled()
  })

  it('does NOT link via an unknown provider', async () => {
    mockSsoProviderFindMany.mockResolvedValue([])
    happyCognito()

    const event = makeEvent()
    const result = await invoke(event)

    expect(linkCall()).toBeUndefined()
    expect(result).toBe(event)
  })

  it('does NOT link via a disabled provider', async () => {
    mockSsoProviderFindMany.mockResolvedValue([enabledProvider({ isEnabled: false })])
    happyCognito()

    await invoke(makeEvent())

    expect(linkCall()).toBeUndefined()
    expect(mockTenantUserFindFirst).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // No native user to link to
  // -------------------------------------------------------------------------

  it('does NOT link when no native user exists for the email', async () => {
    mockSsoProviderFindMany.mockResolvedValue([enabledProvider()])
    mockTenantUserFindFirst.mockResolvedValue({ id: 'tenant-user-1' })
    // Only a pre-existing federated user — not a link destination.
    happyCognito([cognitoUser({ username: 'Microsoft_abc', status: 'EXTERNAL_PROVIDER' })])

    const event = makeEvent()
    const result = await invoke(event)

    expect(linkCall()).toBeUndefined()
    expect(result).toBe(event)
  })

  it('does NOT link when several native users share the email', async () => {
    mockSsoProviderFindMany.mockResolvedValue([enabledProvider()])
    mockTenantUserFindFirst.mockResolvedValue({ id: 'tenant-user-1' })
    happyCognito([cognitoUser(), cognitoUser({ username: 'another-uuid' })])

    await invoke(makeEvent())

    expect(linkCall()).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // The ListUsers filter is a quoted mini-language, and its case semantics for
  // `email` are unspecified — neither may be taken on trust.
  // -------------------------------------------------------------------------

  it('escapes quotes and backslashes in the ListUsers filter value', async () => {
    mockSsoProviderFindMany.mockResolvedValue([enabledProvider()])
    mockTenantUserFindFirst.mockResolvedValue({ id: 'tenant-user-1' })
    happyCognito([])

    await invoke(makeEvent({ email: 'we"ird\\@example.com' }))

    expect(listCall()!.input['Filter']).toBe('email = "we\\"ird\\\\@example.com"')
  })

  it('links a native user whose stored email differs only by case', async () => {
    // The invite path lowercases emails but admin tenant creation does not, so a
    // native user's stored email may be mixed-case. Same person — link it.
    mockSsoProviderFindMany.mockResolvedValue([enabledProvider()])
    mockTenantUserFindFirst.mockResolvedValue({ id: 'tenant-user-1' })
    happyCognito([cognitoUser({ email: 'User@Example.COM' })])

    await invoke(makeEvent({ email: EMAIL }))

    expect(linkCall()!.input).toMatchObject({
      DestinationUser: { ProviderAttributeValue: NATIVE_USERNAME },
    })
  })

  it('does NOT link a returned user whose email is not this email', async () => {
    // Guards against the filter ever matching more loosely than an exact compare.
    mockSsoProviderFindMany.mockResolvedValue([enabledProvider()])
    mockTenantUserFindFirst.mockResolvedValue({ id: 'tenant-user-1' })
    happyCognito([cognitoUser({ email: 'someone.else@example.com' })])

    await invoke(makeEvent())

    expect(linkCall()).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // Native sign-ups must never be affected
  // -------------------------------------------------------------------------

  it.each(['PreSignUp_SignUp', 'PreSignUp_AdminCreateUser'])(
    'is a no-op for %s and returns the event unchanged',
    async (triggerSource) => {
      const event = makeEvent({ triggerSource })
      const result = await invoke(event)

      expect(result).toBe(event)
      expect(mockSsoProviderFindMany).not.toHaveBeenCalled()
      expect(mockCognitoSend).not.toHaveBeenCalled()
    },
  )

  it('never throws for a native sign-up, even if everything else would fail', async () => {
    // A throw here blocks account creation for an invited user. Guard the branch
    // ordering: nothing downstream may be reached.
    mockSsoProviderFindMany.mockRejectedValue(new Error('db is down'))
    mockCognitoSend.mockRejectedValue(new Error('cognito is down'))

    const event = makeEvent({ triggerSource: 'PreSignUp_SignUp' })
    await expect(invoke(event)).resolves.toBe(event)
  })

  // -------------------------------------------------------------------------
  // Failure surfaces rather than leaving a stray account
  // -------------------------------------------------------------------------

  it('surfaces a link failure instead of silently leaving an unlinked account', async () => {
    mockSsoProviderFindMany.mockResolvedValue([enabledProvider()])
    mockTenantUserFindFirst.mockResolvedValue({ id: 'tenant-user-1' })
    mockCognitoSend.mockImplementation(async (cmd: { __type: string }) => {
      if (cmd.__type === 'ListUsers') {
        return { Users: [cognitoUser()] }
      }
      throw new Error('AliasExistsException')
    })

    await expect(invoke(makeEvent())).rejects.toThrow(/Could not link your account/)
  })

  // -------------------------------------------------------------------------
  // Idempotency — a duplicate invocation that re-links is a success, not a failure
  // -------------------------------------------------------------------------

  it('treats "already linked" as success rather than throwing at the user', async () => {
    // The prod case: Cognito fired PreSignUp_ExternalProvider a second time for an
    // identity it had already linked 5s earlier. The link errors, but the identity
    // IS linked — the exact end state this trigger wants.
    mockSsoProviderFindMany.mockResolvedValue([enabledProvider()])
    mockTenantUserFindFirst.mockResolvedValue({ id: 'tenant-user-1' })
    mockCognitoSend.mockImplementation(async (cmd: { __type: string }) => {
      if (cmd.__type === 'ListUsers') {
        return { Users: [cognitoUser()] }
      }
      throw new Error('SourceUser is already linked to DestinationUser')
    })

    const event = makeEvent()
    await expect(invoke(event)).resolves.toBe(event)
  })

  it('still throws for AliasExistsException — a link that genuinely could not be made', async () => {
    // Regression guard on the narrowed catch: the idempotency branch must not
    // widen into other InvalidParameterException-family failures.
    mockSsoProviderFindMany.mockResolvedValue([enabledProvider()])
    mockTenantUserFindFirst.mockResolvedValue({ id: 'tenant-user-1' })
    mockCognitoSend.mockImplementation(async (cmd: { __type: string }) => {
      if (cmd.__type === 'ListUsers') {
        return { Users: [cognitoUser()] }
      }
      throw new Error('AliasExistsException: An account with this email already exists')
    })

    await expect(invoke(makeEvent())).rejects.toThrow(/Could not link your account/)
  })

  it('does not link when the event carries no email', async () => {
    // '' omits the attribute entirely — passing `undefined` would silently fall
    // back to makeEvent's default and test nothing.
    const event = makeEvent({ email: '' })
    const result = await invoke(event)

    expect(result).toBe(event)
    expect(mockCognitoSend).not.toHaveBeenCalled()
  })
})
