// ---------------------------------------------------------------------------
// Unit tests for the Cognito custom-message Lambda trigger
//
// @aws-sdk/client-ssm is fully mocked so tests run without AWS credentials.
// SSM responses are programmable per-test via mockSsmSend so we can cover
// happy-path resolution, missing parameters, and SSM failures.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context } from 'aws-lambda'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockSsmSend, TENANT_BASE, ADMIN_BASE } = vi.hoisted(() => ({
  mockSsmSend: vi.fn(),
  TENANT_BASE: 'https://app.pegasus.test',
  ADMIN_BASE: 'https://admin.pegasus.test',
}))

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn().mockImplementation(function () {
    return { send: mockSsmSend }
  }),
  GetParameterCommand: vi.fn().mockImplementation(function (input: { Name: string }) {
    return { Name: input.Name }
  }),
}))

import { handler } from './custom-message'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeContext = {} as Context
const fakeCallback = () => undefined

type TriggerSource =
  | 'CustomMessage_AdminCreateUser'
  | 'CustomMessage_ForgotPassword'
  | 'CustomMessage_ResendCode'
  | 'CustomMessage_SignUp'
  | 'CustomMessage_UpdateUserAttribute'
  | 'CustomMessage_VerifyUserAttribute'
  | 'CustomMessage_Authentication'

interface BuildEventOptions {
  email?: string
  triggerSource?: TriggerSource
  clientMetadata?: Record<string, string>
  usernameParameter?: string
  codeParameter?: string
}

function makeEvent(opts: BuildEventOptions = {}): Parameters<typeof handler>[0] {
  return {
    version: '1',
    region: 'us-east-1',
    userPoolId: 'us-east-1_test',
    userName: 'invitee@acme.test',
    callerContext: { awsSdkVersion: '1', clientId: 'test-client' },
    triggerSource: (opts.triggerSource ?? 'CustomMessage_AdminCreateUser') as never,
    request: {
      userAttributes: {
        email: opts.email ?? 'invitee@acme.test',
        email_verified: 'true',
      },
      codeParameter: opts.codeParameter ?? '{####}',
      usernameParameter: opts.usernameParameter ?? '{username}',
      ...(opts.clientMetadata !== undefined ? { clientMetadata: opts.clientMetadata } : {}),
    },
    response: { smsMessage: '', emailMessage: '', emailSubject: '' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function defaultClientMetadata(
  overrides: Partial<Record<string, string>> = {},
): Record<string, string> {
  return {
    source: 'tenant',
    tenantId: 'tenant-uuid-123',
    tenantName: 'Acme Movers',
    tenantSlug: 'acme',
    ...overrides,
  } as Record<string, string>
}

// ---------------------------------------------------------------------------
// Default SSM responder — returns the relevant base URL per parameter name
// ---------------------------------------------------------------------------
function ssmResolveOk(): void {
  mockSsmSend.mockImplementation(async (cmd: { Name: string }) => {
    if (cmd.Name === '/dolas/pegasus/web/domain-name') {
      return { Parameter: { Value: TENANT_BASE } }
    }
    if (cmd.Name === '/dolas/pegasus/admin/domain-name') {
      return { Parameter: { Value: ADMIN_BASE } }
    }
    return { Parameter: undefined }
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('custom-message trigger', () => {
  beforeEach(() => {
    vi.resetModules()
    mockSsmSend.mockReset()
    delete process.env['TENANT_LOGIN_URL_FALLBACK']
    delete process.env['ADMIN_LOGIN_URL_FALLBACK']
    ssmResolveOk()
  })

  // ── Pass-through for sources we do not rewrite ────────────────────────────
  // (AdminCreateUser and ForgotPassword are rewritten; everything else is not.)

  it.each([
    'CustomMessage_ResendCode',
    'CustomMessage_SignUp',
    'CustomMessage_UpdateUserAttribute',
    'CustomMessage_VerifyUserAttribute',
    'CustomMessage_Authentication',
  ] as const)('passes through %s unchanged', async (triggerSource) => {
    const event = makeEvent({
      triggerSource,
      clientMetadata: defaultClientMetadata(),
    })
    const result = await handler(event, fakeContext, fakeCallback)

    expect(result.response.emailMessage).toBe('')
    expect(result.response.emailSubject).toBe('')
    expect(mockSsmSend).not.toHaveBeenCalled()
  })

  // ── AdminCreateUser happy path ────────────────────────────────────────────

  it('renders an email body for AdminCreateUser with tenant name and login link', async () => {
    const event = makeEvent({
      email: 'invitee@acme.test',
      clientMetadata: defaultClientMetadata(),
    })
    const result = await handler(event, fakeContext, fakeCallback)

    const body = result.response.emailMessage
    expect(body).toContain('Acme Movers')
    expect(body).toContain('{username}')
    expect(body).toContain('{####}')
    expect(body).toContain(`${TENANT_BASE}/login?email=${encodeURIComponent('invitee@acme.test')}`)
  })

  it('uses the codeParameter / usernameParameter values from the event verbatim', async () => {
    const event = makeEvent({
      clientMetadata: defaultClientMetadata(),
      usernameParameter: '{user-x}',
      codeParameter: '{code-x}',
    })
    const result = await handler(event, fakeContext, fakeCallback)

    expect(result.response.emailMessage).toContain('{user-x}')
    expect(result.response.emailMessage).toContain('{code-x}')
  })

  it('sets a tenant-aware email subject', async () => {
    const event = makeEvent({ clientMetadata: defaultClientMetadata() })
    const result = await handler(event, fakeContext, fakeCallback)

    expect(result.response.emailSubject).toContain('Acme Movers')
  })

  it('HTML-escapes the tenant name to prevent injection', async () => {
    const event = makeEvent({
      clientMetadata: defaultClientMetadata({ tenantName: 'Acme <script>alert(1)</script>' }),
    })
    const result = await handler(event, fakeContext, fakeCallback)

    const body = result.response.emailMessage
    expect(body).not.toContain('<script>')
    expect(body).toContain('&lt;script&gt;')
    expect(body).toContain('&lt;/script&gt;')
  })

  it('URL-encodes the email in the login link', async () => {
    const event = makeEvent({
      email: 'a+b@acme.test',
      clientMetadata: defaultClientMetadata(),
    })
    const result = await handler(event, fakeContext, fakeCallback)

    expect(result.response.emailMessage).toContain(
      `${TENANT_BASE}/login?email=${encodeURIComponent('a+b@acme.test')}`,
    )
  })

  // ── Missing / malformed clientMetadata ────────────────────────────────────

  it('falls back to a generic body when clientMetadata is missing', async () => {
    const event = makeEvent({})
    const result = await handler(event, fakeContext, fakeCallback)

    const body = result.response.emailMessage
    // Still satisfies Cognito's placeholder requirements.
    expect(body).toContain('{username}')
    expect(body).toContain('{####}')
    // Must include a usable login link (tenant base is the safe default).
    expect(body).toContain(`${TENANT_BASE}/login`)
  })

  it('falls back to generic body when source field is unknown', async () => {
    const event = makeEvent({
      clientMetadata: defaultClientMetadata({ source: 'something-else' }),
    })
    const result = await handler(event, fakeContext, fakeCallback)

    expect(result.response.emailMessage).toContain('{username}')
    expect(result.response.emailMessage).toContain('{####}')
  })

  // ── SSM fallback / failure ────────────────────────────────────────────────

  it('uses TENANT_LOGIN_URL_FALLBACK when SSM parameter is empty', async () => {
    mockSsmSend.mockResolvedValue({ Parameter: undefined })
    process.env['TENANT_LOGIN_URL_FALLBACK'] = 'http://localhost:5173'
    process.env['ADMIN_LOGIN_URL_FALLBACK'] = 'http://localhost:5174'

    // Re-import so the module reads the env vars after they're set.
    vi.resetModules()
    const { handler: freshHandler } = await import('./custom-message')

    const event = makeEvent({
      email: 'invitee@acme.test',
      clientMetadata: defaultClientMetadata(),
    })
    const result = await freshHandler(event, fakeContext, fakeCallback)

    expect(result.response.emailMessage).toContain('http://localhost:5173/login?email=')
  })

  it('returns the event unchanged when SSM throws (fail-safe)', async () => {
    mockSsmSend.mockRejectedValue(new Error('SSM exploded'))

    vi.resetModules()
    const { handler: freshHandler } = await import('./custom-message')

    const event = makeEvent({ clientMetadata: defaultClientMetadata() })
    const before = event.response.emailMessage
    const result = await freshHandler(event, fakeContext, fakeCallback)

    // No throw escapes; Cognito then sends its default email.
    expect(result.response.emailMessage).toBe(before)
  })

  // ── SSM caching ───────────────────────────────────────────────────────────

  it('caches the SSM reads across invocations (one call per parameter for cold start)', async () => {
    // Re-import to start with empty module-scope cache.
    vi.resetModules()
    const { handler: freshHandler } = await import('./custom-message')

    const event = makeEvent({ clientMetadata: defaultClientMetadata() })
    await freshHandler(event, fakeContext, fakeCallback)
    await freshHandler(event, fakeContext, fakeCallback)
    await freshHandler(event, fakeContext, fakeCallback)

    const tenantCalls = mockSsmSend.mock.calls.filter(
      ([cmd]) => (cmd as { Name: string }).Name === '/dolas/pegasus/web/domain-name',
    )
    expect(tenantCalls.length).toBe(1)
  })

  // ── Invite copy: the expiry, and how the password actually gets set ────────

  it('states the temporary-password expiry in the invite', async () => {
    // Its absence is what stranded the user who prompted this work: nothing they
    // were ever sent said the password had a lifetime at all.
    const event = makeEvent({ clientMetadata: defaultClientMetadata() })
    const result = await handler(event, fakeContext, fakeCallback)

    expect(result.response.emailMessage).toContain('expires in 7 days')
  })

  it('describes choosing a password as part of signing in, not as a later step', async () => {
    // Cognito issues NEW_PASSWORD_REQUIRED mid-sign-in. The old copy ("please
    // change your temporary password after signing in") described an optional
    // afterwards action that does not exist.
    const event = makeEvent({ clientMetadata: defaultClientMetadata() })
    const result = await handler(event, fakeContext, fakeCallback)

    const body = result.response.emailMessage
    expect(body).toContain('asked to choose a permanent password as you sign in')
    expect(body).not.toContain('after signing in')
  })

  // ── Re-invite variant ─────────────────────────────────────────────────────

  describe('resend (intent: resend)', () => {
    it('uses re-invite wording rather than first-invite wording', async () => {
      const event = makeEvent({
        clientMetadata: defaultClientMetadata({ intent: 'resend' }),
      })
      const result = await handler(event, fakeContext, fakeCallback)

      expect(result.response.emailSubject).toBe(
        'Your new temporary password for Acme Movers on Pegasus',
      )
      expect(result.response.emailMessage).toContain('has been re-sent')
      expect(result.response.emailMessage).not.toContain("You've been invited")
    })

    it('says the earlier temporary password no longer works', async () => {
      // Someone holding two invite emails otherwise cannot tell which is live.
      const event = makeEvent({
        clientMetadata: defaultClientMetadata({ intent: 'resend' }),
      })
      const result = await handler(event, fakeContext, fakeCallback)

      expect(result.response.emailMessage).toContain('no longer works')
      expect(result.response.emailMessage).toContain('expires in 7 days')
    })

    it('still carries the username and password placeholders Cognito substitutes', async () => {
      const event = makeEvent({
        clientMetadata: defaultClientMetadata({ intent: 'resend' }),
      })
      const result = await handler(event, fakeContext, fakeCallback)

      expect(result.response.emailMessage).toContain('{username}')
      expect(result.response.emailMessage).toContain('{####}')
    })

    it('renders the first-invite wording when intent is absent', async () => {
      const event = makeEvent({ clientMetadata: defaultClientMetadata() })
      const result = await handler(event, fakeContext, fakeCallback)

      expect(result.response.emailSubject).toBe("You're invited to Acme Movers on Pegasus")
      expect(result.response.emailMessage).toContain("You've been invited")
    })
  })

  // ── Password-reset email ──────────────────────────────────────────────────

  describe('ForgotPassword', () => {
    it('renders a reset body with the code placeholder and a sign-in link', async () => {
      // Cognito rejects a reset body that omits codeParameter outright.
      const event = makeEvent({ triggerSource: 'CustomMessage_ForgotPassword' })
      const result = await handler(event, fakeContext, fakeCallback)

      expect(result.response.emailSubject).toBe('Your Pegasus password reset code')
      expect(result.response.emailMessage).toContain('{####}')
      expect(result.response.emailMessage).toContain(TENANT_BASE)
      expect(result.response.emailMessage).toContain('Forgot password?')
    })

    it('never claims the current password still works', async () => {
      // An admin-initiated reset (AdminResetUserPassword) arrives on this very
      // source and moves the account to RESET_REQUIRED, so the old password has
      // already stopped working. The copy must hold for both halves.
      const event = makeEvent({ triggerSource: 'CustomMessage_ForgotPassword' })
      const result = await handler(event, fakeContext, fakeCallback)

      expect(result.response.emailMessage).not.toMatch(/current password.*(work|valid)/i)
    })

    it('SECURITY: renders nothing from clientMetadata on this publicly-invocable source', async () => {
      // ForgotPassword is unauthenticated and accepts ClientMetadata, so anyone
      // could invoke it for any address with a payload of their choosing. If
      // this test fails, our own domain is sending attacker-authored prose.
      const attacker = {
        source: 'tenant',
        tenantId: 'pwned',
        tenantName: 'Your account is compromised - call 555-0100 to restore it',
        tenantSlug: 'pwned',
        intent: 'resend',
      }
      const event = makeEvent({
        triggerSource: 'CustomMessage_ForgotPassword',
        clientMetadata: attacker,
      })
      const result = await handler(event, fakeContext, fakeCallback)

      const rendered = result.response.emailMessage + result.response.emailSubject
      expect(rendered).not.toContain('555-0100')
      expect(rendered).not.toContain('compromised')
      expect(rendered).not.toContain('pwned')
    })
  })
})
