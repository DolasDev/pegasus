// ---------------------------------------------------------------------------
// Unit tests for Cognito helpers (cognito.ts)
//
// The AWS SDK client is mocked via vi.hoisted so the same mock send function
// is shared between the vi.mock factory and the test body.
//
// No real Cognito calls are made.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks — shared across vi.mock factories and test bodies
// ---------------------------------------------------------------------------

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}))

// Each command carries a `__command` discriminator because the mock returns the
// raw input object — without it a test cannot tell a ListUsers call from an
// AdminCreateUser one, which is exactly what these helpers branch on.
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn().mockImplementation(function () {
    return { send: mockSend }
  }),
  AdminCreateUserCommand: vi.fn().mockImplementation(function (input: object) {
    return { __command: 'AdminCreateUser', ...input }
  }),
  AdminResetUserPasswordCommand: vi.fn().mockImplementation(function (input: object) {
    return { __command: 'AdminResetUserPassword', ...input }
  }),
  AdminUpdateUserAttributesCommand: vi.fn().mockImplementation(function (input: object) {
    return { __command: 'AdminUpdateUserAttributes', ...input }
  }),
  ListUsersCommand: vi.fn().mockImplementation(function (input: object) {
    return { __command: 'ListUsers', ...input }
  }),
}))

import {
  DuplicateCognitoUserError,
  findCognitoUsersByEmail,
  provisionCognitoUser,
  resetCognitoUserPassword,
  resendCognitoInvite,
  getCognito,
} from './cognito'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tenantContext = {
  tenantId: 'tenant-uuid-1',
  tenantName: 'Acme Movers',
  tenantSlug: 'acme',
}

interface FakeUser {
  username?: string
  email?: string
  status?: string
  verified?: boolean
}

/** A ListUsers user record as Cognito returns it. */
function cognitoUser({
  username = 'cognito-uuid-1',
  email = 'user@acme.com',
  status = 'CONFIRMED',
  verified = true,
}: FakeUser = {}) {
  return {
    Username: username,
    UserStatus: status,
    Attributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: String(verified) },
    ],
  }
}

function listed(...users: FakeUser[]) {
  return { Users: users.map(cognitoUser) }
}

/** Reads the nth command sent to Cognito, with its `__command` discriminator. */
function sentCommand(n: number): Record<string, unknown> {
  return mockSend.mock.calls[n]![0] as Record<string, unknown>
}

function sentCommandNames(): unknown[] {
  return mockSend.mock.calls.map((c) => (c[0] as Record<string, unknown>)['__command'])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getCognito', () => {
  it('returns a CognitoIdentityProviderClient instance', () => {
    const client = getCognito()
    expect(client).toBeDefined()
    expect(typeof client.send).toBe('function')
  })

  it('returns the same singleton instance on subsequent calls', () => {
    const first = getCognito()
    const second = getCognito()
    expect(first).toBe(second)
  })
})

describe('findCognitoUsersByEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries ListUsers with the lowercased, trimmed email', async () => {
    mockSend.mockResolvedValueOnce({ Users: [] })

    await findCognitoUsersByEmail('  TimStrey@Acme.com ')

    expect(sentCommand(0)['__command']).toBe('ListUsers')
    expect(sentCommand(0)['Filter']).toBe('email = "timstrey@acme.com"')
  })

  it('escapes quotes and backslashes in the filter value', async () => {
    mockSend.mockResolvedValueOnce({ Users: [] })

    await findCognitoUsersByEmail('a"b\\c@acme.com')

    expect(sentCommand(0)['Filter']).toBe('email = "a\\"b\\\\c@acme.com"')
  })

  it('finds a native user whose stored email was re-cased by SSO', async () => {
    // Prod, 2026-09-15: Entra asserted `TimStrey@…` and Cognito copied it onto the
    // linked native user. An exact-case lookup by the invited email missed him.
    mockSend.mockResolvedValueOnce(listed({ email: 'TimStrey@acme.com', verified: false }))

    const { native } = await findCognitoUsersByEmail('timstrey@acme.com')

    expect(native?.Username).toBe('cognito-uuid-1')
  })

  it('drops results whose email is a different address', async () => {
    // Guards against a filter that means something looser than we think.
    mockSend.mockResolvedValueOnce(listed({ email: 'timstrey@acme.com.evil' }))

    const result = await findCognitoUsersByEmail('timstrey@acme.com')

    expect(result.native).toBeNull()
    expect(result.federated).toEqual([])
  })

  it('separates unlinked federated identities from the native user', async () => {
    mockSend.mockResolvedValueOnce(
      listed(
        { username: 'microsoft-reliable_abc', status: 'EXTERNAL_PROVIDER' },
        { username: 'cognito-uuid-1', status: 'CONFIRMED' },
      ),
    )

    const { native, federated } = await findCognitoUsersByEmail('user@acme.com')

    expect(native?.Username).toBe('cognito-uuid-1')
    expect(federated.map((u) => u.Username)).toEqual(['microsoft-reliable_abc'])
  })

  it('throws rather than pick one when two native users share the email', async () => {
    mockSend.mockResolvedValueOnce(
      listed(
        { username: 'uuid-a', email: 'Gigi@acme.com' },
        { username: 'uuid-b', email: 'gigi@acme.com' },
      ),
    )

    await expect(findCognitoUsersByEmail('gigi@acme.com')).rejects.toBeInstanceOf(
      DuplicateCognitoUserError,
    )
  })
})

describe('provisionCognitoUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates the user with AdminCreateUser when no one holds the email', async () => {
    mockSend.mockResolvedValueOnce({ Users: [] }).mockResolvedValueOnce({})

    await provisionCognitoUser('new@acme.com', tenantContext)

    expect(sentCommandNames()).toEqual(['ListUsers', 'AdminCreateUser'])
    expect(sentCommand(1)['Username']).toBe('new@acme.com')
    const attrs = sentCommand(1)['UserAttributes'] as Array<{ Name: string; Value: string }>
    expect(attrs).toEqual(
      expect.arrayContaining([
        { Name: 'email', Value: 'new@acme.com' },
        { Name: 'email_verified', Value: 'true' },
      ]),
    )
  })

  it('forwards tenant context as ClientMetadata for the CustomMessage Lambda trigger', async () => {
    mockSend.mockResolvedValueOnce({ Users: [] }).mockResolvedValueOnce({})

    await provisionCognitoUser('new@acme.com', tenantContext)

    expect(sentCommand(1)['ClientMetadata']).toEqual({
      source: 'tenant',
      tenantId: 'tenant-uuid-1',
      tenantName: 'Acme Movers',
      tenantSlug: 'acme',
    })
  })

  it('creates NO duplicate when the existing user’s email differs only in case', async () => {
    // The bug: inviting an SSO user to a second tenant sent AdminCreateUser for
    // `gigi@…` while the pool held `Gigi@…`; the case-sensitive pool accepted it
    // and minted a second identity for the same person.
    mockSend.mockResolvedValueOnce(listed({ email: 'Gigi@acme.com', verified: false }))

    await provisionCognitoUser('gigi@acme.com', tenantContext)

    expect(sentCommandNames()).toEqual(['ListUsers'])
  })

  it('resolves without throwing when AdminCreateUser loses a race (UsernameExistsException)', async () => {
    mockSend
      .mockResolvedValueOnce({ Users: [] })
      .mockRejectedValueOnce(
        Object.assign(new Error('User already exists'), { name: 'UsernameExistsException' }),
      )

    await expect(provisionCognitoUser('existing@acme.com', tenantContext)).resolves.toBeUndefined()
  })

  it('rethrows other AdminCreateUser errors', async () => {
    mockSend
      .mockResolvedValueOnce({ Users: [] })
      .mockRejectedValueOnce(
        Object.assign(new Error('Service unavailable'), { name: 'ServiceFailureException' }),
      )

    await expect(provisionCognitoUser('new@acme.com', tenantContext)).rejects.toThrow(
      'Service unavailable',
    )
  })

  it('rethrows a failed lookup instead of creating blind', async () => {
    mockSend.mockRejectedValueOnce(new Error('Network timeout'))

    await expect(provisionCognitoUser('new@acme.com', tenantContext)).rejects.toThrow(
      'Network timeout',
    )
    expect(sentCommandNames()).toEqual(['ListUsers'])
  })
})

describe('resetCognitoUserPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'production')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resets by the UUID Username, never the email', async () => {
    mockSend.mockResolvedValueOnce(listed({})).mockResolvedValueOnce({})

    await expect(resetCognitoUserPassword('user@acme.com', tenantContext)).resolves.toBe('reset')

    expect(sentCommandNames()).toEqual(['ListUsers', 'AdminResetUserPassword'])
    expect(sentCommand(1)['Username']).toBe('cognito-uuid-1')
  })

  it('re-verifies a re-cased, unverified email before resetting (SSO-linked user)', async () => {
    // Cognito only delivers the reset code to a verified email, and SSO linking
    // leaves it re-cased + email_verified=false.
    mockSend
      .mockResolvedValueOnce(listed({ email: 'TimStrey@acme.com', verified: false }))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})

    await expect(resetCognitoUserPassword('timstrey@acme.com', tenantContext)).resolves.toBe(
      'reset',
    )

    expect(sentCommandNames()).toEqual([
      'ListUsers',
      'AdminUpdateUserAttributes',
      'AdminResetUserPassword',
    ])
    expect(sentCommand(1)['Username']).toBe('cognito-uuid-1')
    expect(sentCommand(1)['UserAttributes']).toEqual([
      { Name: 'email', Value: 'timstrey@acme.com' },
      // Set in the same call so Cognito sends no verification code.
      { Name: 'email_verified', Value: 'true' },
    ])
  })

  it('re-verifies when only email_verified is false', async () => {
    mockSend
      .mockResolvedValueOnce(listed({ verified: false }))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})

    await resetCognitoUserPassword('user@acme.com', tenantContext)

    expect(sentCommandNames()).toContain('AdminUpdateUserAttributes')
  })

  it('leaves a clean lowercase, verified email untouched', async () => {
    mockSend.mockResolvedValueOnce(listed({})).mockResolvedValueOnce({})

    await resetCognitoUserPassword('user@acme.com', tenantContext)

    expect(sentCommandNames()).not.toContain('AdminUpdateUserAttributes')
  })

  it('sends a fresh temporary password when the user never set one (FORCE_CHANGE_PASSWORD)', async () => {
    // Tim went straight to SSO: there is no password to reset, and
    // AdminResetUserPassword is not the operation for this state.
    mockSend
      .mockResolvedValueOnce(
        listed({ status: 'FORCE_CHANGE_PASSWORD', email: 'TimStrey@acme.com' }),
      )
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})

    await expect(resetCognitoUserPassword('timstrey@acme.com', tenantContext)).resolves.toBe(
      'resent',
    )

    expect(sentCommandNames()).toEqual([
      'ListUsers',
      'AdminUpdateUserAttributes',
      'AdminCreateUser',
    ])
    expect(sentCommand(2)['MessageAction']).toBe('RESEND')
    expect(sentCommand(2)['Username']).toBe('cognito-uuid-1')
    expect(sentCommand(2)['ClientMetadata']).toEqual({
      source: 'tenant',
      tenantId: 'tenant-uuid-1',
      tenantName: 'Acme Movers',
      tenantSlug: 'acme',
      intent: 'resend',
    })
  })

  it('skips the temporary-password email outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    mockSend.mockResolvedValueOnce(listed({ status: 'FORCE_CHANGE_PASSWORD' }))

    await expect(resetCognitoUserPassword('user@acme.com', tenantContext)).resolves.toBe('skipped')

    expect(sentCommandNames()).toEqual(['ListUsers'])
  })

  it('reports not_found — instead of silently succeeding — when no native user exists', async () => {
    mockSend.mockResolvedValueOnce({ Users: [] })

    await expect(resetCognitoUserPassword('ghost@acme.com', tenantContext)).resolves.toBe(
      'not_found',
    )
    expect(sentCommandNames()).toEqual(['ListUsers'])
  })

  it('rethrows Cognito errors from the reset', async () => {
    mockSend
      .mockResolvedValueOnce(listed({}))
      .mockRejectedValueOnce(
        Object.assign(new Error('Access denied'), { name: 'NotAuthorizedException' }),
      )

    await expect(resetCognitoUserPassword('user@acme.com', tenantContext)).rejects.toThrow(
      'Access denied',
    )
  })
})

// ---------------------------------------------------------------------------
// resendCognitoInvite — the "temporary password expired" recovery path
// ---------------------------------------------------------------------------

describe('resendCognitoInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Every deployed environment (QA included) runs NODE_ENV=production — only
    // local dev and vitest do not. Opt in so the real path is under test.
    vi.stubEnv('NODE_ENV', 'production')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resends the invite by UUID Username when the user is still in FORCE_CHANGE_PASSWORD', async () => {
    mockSend
      .mockResolvedValueOnce(listed({ status: 'FORCE_CHANGE_PASSWORD', email: 'Pending@acme.com' }))
      .mockResolvedValueOnce({})

    await expect(resendCognitoInvite('pending@acme.com', tenantContext)).resolves.toBe('resent')

    expect(sentCommandNames()).toEqual(['ListUsers', 'AdminCreateUser'])
    expect(sentCommand(1)['MessageAction']).toBe('RESEND')
    expect(sentCommand(1)['Username']).toBe('cognito-uuid-1')
  })

  it('re-sends tenant context as ClientMetadata so the invite email stays tenant-aware', async () => {
    // Without ClientMetadata the CustomMessage Lambda passes the event through
    // unchanged and the invitee gets Cognito's stock template — no tenant name,
    // no login link. This is the regression that silently degrades the email.
    mockSend
      .mockResolvedValueOnce(listed({ status: 'FORCE_CHANGE_PASSWORD' }))
      .mockResolvedValueOnce({})

    await resendCognitoInvite('user@acme.com', tenantContext)

    expect(sentCommand(1)['ClientMetadata']).toEqual({
      source: 'tenant',
      tenantId: 'tenant-uuid-1',
      tenantName: 'Acme Movers',
      tenantSlug: 'acme',
      // Drives the re-invite wording in cognito/custom-message.ts. Without it a
      // resend reads exactly like a first invite.
      intent: 'resend',
    })
  })

  it('never pairs MessageAction RESEND with SUPPRESS (one mutually exclusive enum)', async () => {
    mockSend
      .mockResolvedValueOnce(listed({ status: 'FORCE_CHANGE_PASSWORD' }))
      .mockResolvedValueOnce({})

    await resendCognitoInvite('user@acme.com', tenantContext)

    expect(sentCommand(1)['MessageAction']).not.toBe('SUPPRESS')
  })

  // The pool is shared across every tenant, and a tenant admin can mint a
  // PENDING row for an arbitrary address. So the ONLY identity this helper may
  // mutate is one that has never completed a login anywhere —
  // FORCE_CHANGE_PASSWORD. Every other state belongs to a real account, quite
  // possibly on a different tenant.
  it.each(['CONFIRMED', 'RESET_REQUIRED', 'UNCONFIRMED'])(
    'refuses without any Cognito write when the user is %s',
    async (status) => {
      mockSend.mockResolvedValueOnce(listed({ status }))

      await expect(resendCognitoInvite('user@acme.com', tenantContext)).resolves.toBe(
        'already_registered',
      )

      // The lookup and nothing else — no reset, no resend.
      expect(sentCommandNames()).toEqual(['ListUsers'])
    },
  )

  it('refuses when the only identity is an unlinked federated (EXTERNAL_PROVIDER) user', async () => {
    mockSend.mockResolvedValueOnce(
      listed({ username: 'microsoft-nw_abc', status: 'EXTERNAL_PROVIDER' }),
    )

    await expect(resendCognitoInvite('user@acme.com', tenantContext)).resolves.toBe(
      'already_registered',
    )
    expect(sentCommandNames()).toEqual(['ListUsers'])
  })

  it('never resets the password of an identity registered on another tenant', async () => {
    // Regression: an earlier revision mapped CONFIRMED to AdminResetUserPassword,
    // which let tenant A invalidate a tenant-B user's password by inviting their
    // email and clicking Resend. pre-token.ts flips PENDING -> ACTIVE on any
    // successful login, so that branch had no legitimate target to begin with.
    mockSend.mockResolvedValueOnce(listed({ status: 'CONFIRMED', email: 'Victim@other.com' }))

    await resendCognitoInvite('victim@other.com', tenantContext)

    expect(sentCommandNames()).not.toContain('AdminResetUserPassword')
    expect(sentCommandNames()).not.toContain('AdminCreateUser')
  })

  it('refuses a re-cased CONFIRMED user instead of creating a duplicate', async () => {
    // Before the case-insensitive lookup, AdminGetUser(`victim@…`) missed
    // `Victim@…`, fell into "no such user", and minted a second identity.
    mockSend.mockResolvedValueOnce(listed({ status: 'CONFIRMED', email: 'Victim@other.com' }))

    await expect(resendCognitoInvite('victim@other.com', tenantContext)).resolves.toBe(
      'already_registered',
    )
  })

  it('creates the account fresh when Cognito has no such user', async () => {
    mockSend.mockResolvedValueOnce({ Users: [] }).mockResolvedValueOnce({})

    await expect(resendCognitoInvite('ghost@acme.com', tenantContext)).resolves.toBe('created')

    expect(sentCommandNames()).toEqual(['ListUsers', 'AdminCreateUser'])
    expect(sentCommand(1)['MessageAction']).toBeUndefined()
    expect(sentCommand(1)['ClientMetadata']).toEqual({
      source: 'tenant',
      tenantId: 'tenant-uuid-1',
      tenantName: 'Acme Movers',
      tenantSlug: 'acme',
    })
  })

  it('rethrows a failure from the lookup', async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error('Access denied'), { name: 'NotAuthorizedException' }),
    )

    await expect(resendCognitoInvite('user@acme.com', tenantContext)).rejects.toThrow(
      'Access denied',
    )
  })

  it('sends no invite email outside production (mirrors the invite path)', async () => {
    vi.stubEnv('NODE_ENV', 'test')

    await expect(resendCognitoInvite('pending@acme.com', tenantContext)).resolves.toBe('skipped')

    expect(mockSend).not.toHaveBeenCalled()
  })
})
