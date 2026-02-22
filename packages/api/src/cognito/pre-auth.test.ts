// ---------------------------------------------------------------------------
// Unit tests for the Cognito pre-authentication Lambda trigger
//
// @aws-sdk/client-cognito-identity-provider is fully mocked so tests run
// without any network access or real AWS credentials.
//
// The module-level `cognitoClient` is constructed once at import time, so
// vi.hoisted() is used to ensure the mock send function is available before
// the factory runs and the module is imported.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context } from 'aws-lambda'

// ---------------------------------------------------------------------------
// SDK mock — hoisted so the send fn is available inside vi.mock factory
// ---------------------------------------------------------------------------

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn(() => ({ send: mockSend })),
  AdminGetUserCommand: vi.fn((params: unknown) => ({ _cmd: 'AdminGetUser', params })),
  AdminListGroupsForUserCommand: vi.fn((params: unknown) => ({
    _cmd: 'AdminListGroups',
    params,
  })),
}))

import { handler } from './pre-auth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Cognito PreAuthentication trigger event. */
function makeEvent(userName: string) {
  return {
    version: '1',
    triggerSource: 'PreAuthentication_Authentication' as const,
    region: 'us-east-1',
    userPoolId: 'us-east-1_test',
    callerContext: { awsSdkVersion: '1', clientId: 'test-client' },
    request: { userAttributes: {}, validationData: undefined },
    response: {},
    userName,
  }
}

/** Mocks the two sequential AWS SDK calls in the expected order. */
function mockCognito({
  userStatus = 'CONFIRMED',
  mfaList = [] as string[],
  groups = [] as string[],
} = {}) {
  mockSend
    .mockResolvedValueOnce({
      UserStatus: userStatus,
      UserMFASettingList: mfaList,
    })
    .mockResolvedValueOnce({
      Groups: groups.map((GroupName) => ({ GroupName })),
    })
}

const fakeContext = {} as Context
const fakeCallback = () => undefined

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pre-auth trigger', () => {
  beforeEach(() => {
    mockSend.mockReset()
    process.env['USER_POOL_ID'] = 'us-east-1_test'
  })

  // ── Non-admin users pass through unconditionally ──────────────────────────

  it('passes a CONFIRMED non-admin user through', async () => {
    mockCognito({ userStatus: 'CONFIRMED', groups: [] })

    const event = makeEvent('tenant-user')
    const result = await handler(event, fakeContext, fakeCallback)
    expect(result).toBe(event)
  })

  it('passes a non-admin user in FORCE_CHANGE_PASSWORD status through', async () => {
    // Regular users can be in FORCE_CHANGE_PASSWORD; Cognito handles that flow.
    mockCognito({ userStatus: 'FORCE_CHANGE_PASSWORD', groups: ['SOME_OTHER_GROUP'] })

    const event = makeEvent('new-tenant-user')
    const result = await handler(event, fakeContext, fakeCallback)
    expect(result).toBe(event)
  })

  // ── PLATFORM_ADMIN with MFA enrolled — happy path ─────────────────────────

  it('passes a PLATFORM_ADMIN user who has TOTP enrolled', async () => {
    mockCognito({
      userStatus: 'CONFIRMED',
      mfaList: ['SOFTWARE_TOKEN_MFA'],
      groups: ['PLATFORM_ADMIN'],
    })

    const event = makeEvent('admin@pegasus.com')
    const result = await handler(event, fakeContext, fakeCallback)
    expect(result).toBe(event)
  })

  it('passes a PLATFORM_ADMIN user with multiple MFA methods enrolled', async () => {
    mockCognito({
      userStatus: 'CONFIRMED',
      mfaList: ['SOFTWARE_TOKEN_MFA', 'SMS_MFA'],
      groups: ['PLATFORM_ADMIN', 'ANOTHER_GROUP'],
    })

    const event = makeEvent('superadmin@pegasus.com')
    const result = await handler(event, fakeContext, fakeCallback)
    expect(result).toBe(event)
  })

  // ── PLATFORM_ADMIN without MFA — blocked ──────────────────────────────────

  it('blocks a PLATFORM_ADMIN user who has not enrolled MFA', async () => {
    mockCognito({
      userStatus: 'CONFIRMED',
      mfaList: [],
      groups: ['PLATFORM_ADMIN'],
    })

    await expect(handler(makeEvent('admin-no-mfa'), fakeContext, fakeCallback)).rejects.toThrow(
      'MFA enrollment is required',
    )
  })

  // ── PLATFORM_ADMIN in FORCE_CHANGE_PASSWORD — blocked ────────────────────
  //
  // This is an anomalous state: the create-admin-user script always sets a
  // permanent password before adding the user to PLATFORM_ADMIN. A user in
  // this state was added to the group by means other than the guided script
  // and must complete proper onboarding before being allowed to sign in.

  it('blocks a PLATFORM_ADMIN user in FORCE_CHANGE_PASSWORD status', async () => {
    mockCognito({
      userStatus: 'FORCE_CHANGE_PASSWORD',
      mfaList: [],
      groups: ['PLATFORM_ADMIN'],
    })

    await expect(
      handler(makeEvent('admin-incomplete'), fakeContext, fakeCallback),
    ).rejects.toThrow('account setup is incomplete')
  })

  // ── Fail-closed on configuration errors ───────────────────────────────────

  it('blocks sign-in when USER_POOL_ID env var is not set', async () => {
    delete process.env['USER_POOL_ID']

    await expect(handler(makeEvent('any-user'), fakeContext, fakeCallback)).rejects.toThrow(
      'Authentication configuration error',
    )
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('blocks sign-in on unexpected SDK errors (fail-closed)', async () => {
    mockSend.mockRejectedValueOnce(new Error('IAM policy denied'))

    await expect(handler(makeEvent('admin@pegasus.com'), fakeContext, fakeCallback)).rejects.toThrow(
      'Authentication check failed',
    )
  })

  it('re-throws MFA rejection message unchanged so Cognito surfaces it', async () => {
    mockCognito({ userStatus: 'CONFIRMED', mfaList: [], groups: ['PLATFORM_ADMIN'] })

    await expect(
      handler(makeEvent('admin-no-mfa'), fakeContext, fakeCallback),
    ).rejects.toThrow('MFA enrollment is required')
  })

  it('re-throws incomplete-setup message unchanged so Cognito surfaces it', async () => {
    mockCognito({
      userStatus: 'FORCE_CHANGE_PASSWORD',
      mfaList: [],
      groups: ['PLATFORM_ADMIN'],
    })

    await expect(
      handler(makeEvent('admin-incomplete'), fakeContext, fakeCallback),
    ).rejects.toThrow('account setup is incomplete')
  })
})
