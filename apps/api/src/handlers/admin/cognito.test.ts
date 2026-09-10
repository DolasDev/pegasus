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
// raw input object — without it a test cannot tell an AdminGetUser call from an
// AdminCreateUser one, which is exactly what resendCognitoInvite's branching does.
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
  AdminGetUserCommand: vi.fn().mockImplementation(function (input: object) {
    return { __command: 'AdminGetUser', ...input }
  }),
}))

import {
  provisionCognitoUser,
  resetCognitoUserPassword,
  resendCognitoInvite,
  getCognito,
} from './cognito'

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

describe('provisionCognitoUser', () => {
  const tenantContext = {
    tenantId: 'tenant-uuid-1',
    tenantName: 'Acme Movers',
    tenantSlug: 'acme',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls Cognito AdminCreateUser with the given email', async () => {
    mockSend.mockResolvedValue({})

    await provisionCognitoUser('new@acme.com', tenantContext)

    expect(mockSend).toHaveBeenCalledOnce()
    const sentCommand = mockSend.mock.calls[0]![0] as Record<string, unknown>
    expect(sentCommand['Username']).toBe('new@acme.com')
    const attrs = sentCommand['UserAttributes'] as Array<{ Name: string; Value: string }>
    expect(attrs).toEqual(
      expect.arrayContaining([
        { Name: 'email', Value: 'new@acme.com' },
        { Name: 'email_verified', Value: 'true' },
      ]),
    )
  })

  it('forwards tenant context as ClientMetadata for the CustomMessage Lambda trigger', async () => {
    mockSend.mockResolvedValue({})

    await provisionCognitoUser('new@acme.com', tenantContext)

    const sentCommand = mockSend.mock.calls[0]![0] as { ClientMetadata?: Record<string, string> }
    expect(sentCommand.ClientMetadata).toEqual({
      source: 'tenant',
      tenantId: 'tenant-uuid-1',
      tenantName: 'Acme Movers',
      tenantSlug: 'acme',
    })
  })

  it('resolves without throwing when Cognito returns UsernameExistsException', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('User already exists'), { name: 'UsernameExistsException' }),
    )

    await expect(provisionCognitoUser('existing@acme.com', tenantContext)).resolves.toBeUndefined()
    expect(mockSend).toHaveBeenCalledOnce()
  })

  it('rethrows non-UsernameExistsException errors', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('Service unavailable'), { name: 'ServiceFailureException' }),
    )

    await expect(provisionCognitoUser('new@acme.com', tenantContext)).rejects.toThrow(
      'Service unavailable',
    )
  })

  it('rethrows generic errors (no name property)', async () => {
    mockSend.mockRejectedValue(new Error('Network timeout'))

    await expect(provisionCognitoUser('new@acme.com', tenantContext)).rejects.toThrow(
      'Network timeout',
    )
  })
})

describe('resetCognitoUserPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls Cognito AdminResetUserPassword with the given email', async () => {
    mockSend.mockResolvedValue({})

    await resetCognitoUserPassword('user@acme.com')

    expect(mockSend).toHaveBeenCalledOnce()
    const sentCommand = mockSend.mock.calls[0]![0] as Record<string, unknown>
    expect(sentCommand['Username']).toBe('user@acme.com')
  })

  it('resolves without throwing when Cognito returns UserNotFoundException (fail-open)', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('User not found'), { name: 'UserNotFoundException' }),
    )

    await expect(resetCognitoUserPassword('ghost@acme.com')).resolves.toBeUndefined()
    expect(mockSend).toHaveBeenCalledOnce()
  })

  it('rethrows non-UserNotFoundException errors', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('Access denied'), { name: 'NotAuthorizedException' }),
    )

    await expect(resetCognitoUserPassword('user@acme.com')).rejects.toThrow('Access denied')
  })
})

// ---------------------------------------------------------------------------
// resendCognitoInvite — the "temporary password expired" recovery path
// ---------------------------------------------------------------------------

describe('resendCognitoInvite', () => {
  const tenantContext = {
    tenantId: 'tenant-uuid-1',
    tenantName: 'Acme Movers',
    tenantSlug: 'acme',
  }

  /** Reads the nth command sent to Cognito, with its `__command` discriminator. */
  function sentCommand(n: number): Record<string, unknown> {
    return mockSend.mock.calls[n]![0] as Record<string, unknown>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Every deployed environment (QA included) runs NODE_ENV=production — only
    // local dev and vitest do not. Opt in so the real path is under test.
    vi.stubEnv('NODE_ENV', 'production')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resends the invite when the user is still in FORCE_CHANGE_PASSWORD', async () => {
    mockSend
      .mockResolvedValueOnce({ UserStatus: 'FORCE_CHANGE_PASSWORD' })
      .mockResolvedValueOnce({})

    await expect(resendCognitoInvite('pending@acme.com', tenantContext)).resolves.toBe('resent')

    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(sentCommand(0)['__command']).toBe('AdminGetUser')
    expect(sentCommand(1)['__command']).toBe('AdminCreateUser')
    expect(sentCommand(1)['MessageAction']).toBe('RESEND')
    expect(sentCommand(1)['Username']).toBe('pending@acme.com')
  })

  it('re-sends tenant context as ClientMetadata so the invite email stays tenant-aware', async () => {
    // Without ClientMetadata the CustomMessage Lambda passes the event through
    // unchanged and the invitee gets Cognito's stock template — no tenant name,
    // no login link. This is the regression that silently degrades the email.
    mockSend
      .mockResolvedValueOnce({ UserStatus: 'FORCE_CHANGE_PASSWORD' })
      .mockResolvedValueOnce({})

    await resendCognitoInvite('pending@acme.com', tenantContext)

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
      .mockResolvedValueOnce({ UserStatus: 'FORCE_CHANGE_PASSWORD' })
      .mockResolvedValueOnce({})

    await resendCognitoInvite('pending@acme.com', tenantContext)

    expect(sentCommand(1)['MessageAction']).not.toBe('SUPPRESS')
  })

  // The pool is shared across every tenant and keyed by email, and a tenant
  // admin can mint a PENDING row for an arbitrary address. So the ONLY identity
  // this helper may mutate is one that has never completed a login anywhere —
  // FORCE_CHANGE_PASSWORD. Every other state belongs to a real account, quite
  // possibly on a different tenant.
  it.each(['CONFIRMED', 'RESET_REQUIRED', 'EXTERNAL_PROVIDER', 'UNCONFIRMED'])(
    'refuses without any Cognito write when the user is %s',
    async (status) => {
      mockSend.mockResolvedValueOnce({ UserStatus: status })

      await expect(resendCognitoInvite('someone@acme.com', tenantContext)).resolves.toBe(
        'already_registered',
      )

      // The state read and nothing else — no reset, no resend.
      expect(mockSend).toHaveBeenCalledOnce()
      expect(sentCommand(0)['__command']).toBe('AdminGetUser')
    },
  )

  it('never resets the password of an identity registered on another tenant', async () => {
    // Regression: an earlier revision mapped CONFIRMED to AdminResetUserPassword,
    // which let tenant A invalidate a tenant-B user's password by inviting their
    // email and clicking Resend. pre-token.ts flips PENDING -> ACTIVE on any
    // successful login, so that branch had no legitimate target to begin with.
    mockSend.mockResolvedValueOnce({ UserStatus: 'CONFIRMED' })

    await resendCognitoInvite('victim@other-tenant.com', tenantContext)

    const commands = mockSend.mock.calls.map((c) => (c[0] as Record<string, unknown>)['__command'])
    expect(commands).not.toContain('AdminResetUserPassword')
    expect(commands).not.toContain('AdminCreateUser')
  })

  it('creates the account fresh when Cognito has no such user', async () => {
    mockSend
      .mockRejectedValueOnce(
        Object.assign(new Error('User does not exist'), { name: 'UserNotFoundException' }),
      )
      .mockResolvedValueOnce({})

    await expect(resendCognitoInvite('ghost@acme.com', tenantContext)).resolves.toBe('created')

    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(sentCommand(1)['__command']).toBe('AdminCreateUser')
    expect(sentCommand(1)['MessageAction']).toBeUndefined()
    expect(sentCommand(1)['ClientMetadata']).toEqual({
      source: 'tenant',
      tenantId: 'tenant-uuid-1',
      tenantName: 'Acme Movers',
      tenantSlug: 'acme',
    })
  })

  it('rethrows a non-UserNotFoundException failure from the state read', async () => {
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
