// ---------------------------------------------------------------------------
// Unit tests for Cognito helpers (cognito.ts)
//
// The AWS SDK client is mocked via vi.hoisted so the same mock send function
// is shared between the vi.mock factory and the test body.
//
// No real Cognito calls are made.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks — shared across vi.mock factories and test bodies
// ---------------------------------------------------------------------------

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}))

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn().mockImplementation(function () {
    return { send: mockSend }
  }),
  AdminCreateUserCommand: vi.fn().mockImplementation(function (input: unknown) {
    return input
  }),
  AdminDisableUserCommand: vi.fn().mockImplementation(function (input: unknown) {
    return input
  }),
}))

import { provisionCognitoUser, disableCognitoUser, getCognito } from './cognito'

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

describe('disableCognitoUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls Cognito AdminDisableUser with the given email', async () => {
    mockSend.mockResolvedValue({})

    await disableCognitoUser('user@acme.com')

    expect(mockSend).toHaveBeenCalledOnce()
    const sentCommand = mockSend.mock.calls[0]![0] as Record<string, unknown>
    expect(sentCommand['Username']).toBe('user@acme.com')
  })

  it('resolves without throwing when Cognito returns UserNotFoundException (fail-open)', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('User not found'), { name: 'UserNotFoundException' }),
    )

    await expect(disableCognitoUser('ghost@acme.com')).resolves.toBeUndefined()
    expect(mockSend).toHaveBeenCalledOnce()
  })

  it('rethrows non-UserNotFoundException errors', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('Access denied'), { name: 'NotAuthorizedException' }),
    )

    await expect(disableCognitoUser('user@acme.com')).rejects.toThrow('Access denied')
  })

  it('rethrows generic errors (no name property)', async () => {
    mockSend.mockRejectedValue(new Error('Network error'))

    await expect(disableCognitoUser('user@acme.com')).rejects.toThrow('Network error')
  })
})
