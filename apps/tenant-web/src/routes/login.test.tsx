// ---------------------------------------------------------------------------
// LoginPage tests — multi-tenant login flow
//
// Tests focus on the select-tenant step: the tenant picker shown when multiple
// tenants are returned by resolveTenantsForEmail, and skipping the picker when
// exactly one tenant is returned.
//
// Network calls and Cognito helpers are mocked. Only the tenant-resolution
// and tenant-selection paths are exercised here — the SSO redirect and
// password flows are out of scope for these tests.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LoginPage } from './login'

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('@/auth/tenant-resolver', () => ({
  resolveTenantsForEmail: vi.fn(),
  selectTenant: vi.fn(),
}))

// CognitoError must be a real class — the forgot-password path branches on
// `err instanceof CognitoError`. Defined via vi.hoisted so the (hoisted)
// vi.mock factory below can reference it.
const { MockCognitoError } = vi.hoisted(() => ({
  MockCognitoError: class extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
      this.name = code
    }
  },
}))

vi.mock('@/auth/cognito', () => ({
  getCognitoConfig: vi.fn(() => ({
    userPoolId: 'us-east-1_test',
    clientId: 'test-client-id',
    domain: 'auth.test.example.com',
    redirectUri: 'https://app.test/login/callback',
  })),
  buildAuthorizeUrl: vi.fn(() => 'https://auth.test/oauth2/authorize?mock'),
  signIn: vi.fn(),
  respondToMfaChallenge: vi.fn(),
  respondToNewPasswordChallenge: vi.fn(),
  forgotPassword: vi.fn(),
  confirmForgotPassword: vi.fn(),
  passwordPolicyMessage: vi.fn(() => null),
  CognitoError: MockCognitoError,
}))

vi.mock('@/auth/pkce', () => ({
  generateCodeVerifier: vi.fn(() => 'mock-verifier'),
  generateCodeChallenge: vi.fn(async () => 'mock-challenge'),
  generateState: vi.fn(() => 'mock-state'),
  savePkceState: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public code: string,
      public status: number,
    ) {
      super(message)
    }
  },
}))

vi.mock('@/auth/session', () => ({
  setSession: vi.fn(),
  getSession: vi.fn(() => null),
}))

vi.mock('../config', () => ({
  getConfig: () => ({ apiUrl: 'https://api.test' }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { resolveTenantsForEmail, selectTenant } from '@/auth/tenant-resolver'
import { forgotPassword } from '@/auth/cognito'
import type { TenantResolution } from '@/auth/tenant-resolver'

const mockResolveTenantsForEmail = vi.mocked(resolveTenantsForEmail)
const mockSelectTenant = vi.mocked(selectTenant)

function makeTenant(overrides?: Partial<TenantResolution>): TenantResolution {
  return {
    tenantId: overrides?.tenantId ?? 'tenant-1',
    tenantName: overrides?.tenantName ?? 'Acme Corp',
    cognitoAuthEnabled: overrides?.cognitoAuthEnabled ?? true,
    providers: overrides?.providers ?? [],
  }
}

async function submitEmail(email: string) {
  const input = screen.getByLabelText(/work email/i)
  fireEvent.change(input, { target: { value: email } })
  const button = screen.getByRole('button', { name: /continue/i })
  fireEvent.click(button)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoginPage — select-tenant step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows tenant picker when multiple tenants are returned', async () => {
    mockResolveTenantsForEmail.mockResolvedValue([
      makeTenant({ tenantId: 'tenant-1', tenantName: 'Acme Corp' }),
      makeTenant({ tenantId: 'tenant-2', tenantName: 'Beta Inc' }),
    ])

    render(<LoginPage />)
    await submitEmail('user@shared.com')

    await waitFor(() => {
      expect(screen.getByText('Choose your organization')).toBeInTheDocument()
    })
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    expect(screen.getByText('Beta Inc')).toBeInTheDocument()
  })

  it('skips the picker and shows auth options when only one tenant is returned', async () => {
    mockResolveTenantsForEmail.mockResolvedValue([
      makeTenant({ tenantId: 'tenant-1', tenantName: 'Acme Corp', cognitoAuthEnabled: true }),
    ])
    mockSelectTenant.mockResolvedValue(
      makeTenant({ tenantId: 'tenant-1', tenantName: 'Acme Corp', cognitoAuthEnabled: true }),
    )

    render(<LoginPage />)
    await submitEmail('user@acme.com')

    // Should NOT show the tenant picker
    await waitFor(() => {
      expect(screen.queryByText('Choose your organization')).not.toBeInTheDocument()
    })
    // Should proceed directly to auth options (password or provider step)
    await waitFor(() => {
      expect(mockSelectTenant).toHaveBeenCalledWith('user@acme.com', 'tenant-1')
    })
  })

  it('shows error when no tenants returned', async () => {
    mockResolveTenantsForEmail.mockResolvedValue([])

    render(<LoginPage />)
    await submitEmail('user@unknown.com')

    await waitFor(() => {
      expect(screen.getByText(/unable to continue/i)).toBeInTheDocument()
    })
  })

  it('calls selectTenant when user picks from the picker', async () => {
    mockResolveTenantsForEmail.mockResolvedValue([
      makeTenant({ tenantId: 'tenant-1', tenantName: 'Acme Corp' }),
      makeTenant({ tenantId: 'tenant-2', tenantName: 'Beta Inc' }),
    ])
    mockSelectTenant.mockResolvedValue(
      makeTenant({ tenantId: 'tenant-2', tenantName: 'Beta Inc', cognitoAuthEnabled: true }),
    )

    render(<LoginPage />)
    await submitEmail('user@shared.com')

    await waitFor(() => {
      expect(screen.getByText('Beta Inc')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Beta Inc'))

    await waitFor(() => {
      expect(mockSelectTenant).toHaveBeenCalledWith('user@shared.com', 'tenant-2')
    })
  })

  it('shows "Use a different email" link in tenant picker', async () => {
    mockResolveTenantsForEmail.mockResolvedValue([
      makeTenant({ tenantId: 'tenant-1', tenantName: 'Acme' }),
      makeTenant({ tenantId: 'tenant-2', tenantName: 'Beta' }),
    ])

    render(<LoginPage />)
    await submitEmail('user@shared.com')

    await waitFor(() => {
      expect(screen.getByText(/use a different email/i)).toBeInTheDocument()
    })
  })

  it('returns to email step when "Use a different email" is clicked', async () => {
    mockResolveTenantsForEmail.mockResolvedValue([
      makeTenant({ tenantId: 'tenant-1', tenantName: 'Acme' }),
      makeTenant({ tenantId: 'tenant-2', tenantName: 'Beta' }),
    ])

    render(<LoginPage />)
    await submitEmail('user@shared.com')

    await waitFor(() => {
      expect(screen.getByText(/use a different email/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/use a different email/i))

    await waitFor(() => {
      expect(screen.getByLabelText(/work email/i)).toBeInTheDocument()
    })
  })

  it('shows error when resolveTenantsForEmail throws', async () => {
    mockResolveTenantsForEmail.mockRejectedValue(new Error('Network failure'))

    render(<LoginPage />)
    await submitEmail('user@acme.com')

    await waitFor(() => {
      expect(screen.getByText(/unable to reach the authentication service/i)).toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// Forgot-password refusal
//
// Cognito refuses ForgotPassword for a federated account AND for an account
// still holding an unredeemed invitation, with the same two exception codes and
// no way to tell them apart. The page used to assert the federated explanation
// unconditionally, which told an invitee whose temporary password had expired
// that they were an SSO user.
// ---------------------------------------------------------------------------

describe('LoginPage — forgot-password refusal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** Drives email → password step → "Forgot password?" → submit the reset form.
   *  A tenant with SSO providers lands on the method picker first, so choose
   *  the password option when it appears. */
  async function reachForgotAndSubmit(tenants: TenantResolution[]) {
    mockResolveTenantsForEmail.mockResolvedValue(tenants)
    mockSelectTenant.mockResolvedValue(tenants[0]!)

    render(<LoginPage />)
    await submitEmail('user@acme.com')

    if (tenants[0]!.providers.length > 0) {
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sign in with password/i })).toBeInTheDocument()
      })
      fireEvent.click(screen.getByRole('button', { name: /sign in with password/i }))
    }

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /forgot password\?/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /forgot password\?/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send reset code/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /send reset code/i }))
  }

  it('does not blame SSO when the tenant has no identity provider', async () => {
    vi.mocked(forgotPassword).mockRejectedValue(
      new MockCognitoError('NotAuthorizedException', 'User password cannot be reset'),
    )

    await reachForgotAndSubmit([makeTenant({ providers: [] })])

    await waitFor(() => {
      expect(
        screen.getByText(/ask your administrator to resend your invitation/i),
      ).toBeInTheDocument()
    })
    expect(screen.queryByText(/identity provider/i)).not.toBeInTheDocument()
  })

  it('offers both explanations when the tenant does have an identity provider', async () => {
    vi.mocked(forgotPassword).mockRejectedValue(
      new MockCognitoError('InvalidParameterException', 'Cannot reset password'),
    )

    await reachForgotAndSubmit([
      makeTenant({ providers: [{ id: 'okta', name: 'Okta', type: 'oidc' }] }),
    ])

    await waitFor(() => {
      expect(screen.getByText(/identity provider/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/resend your invitation/i)).toBeInTheDocument()
  })

  it('falls back to generic copy when the re-resolve fails', async () => {
    vi.mocked(forgotPassword).mockRejectedValue(
      new MockCognitoError('NotAuthorizedException', 'nope'),
    )
    mockResolveTenantsForEmail
      .mockResolvedValueOnce([makeTenant({ providers: [] })])
      .mockRejectedValueOnce(new Error('offline'))
    mockSelectTenant.mockResolvedValue(makeTenant({ providers: [] }))

    render(<LoginPage />)
    await submitEmail('user@acme.com')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /forgot password\?/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /forgot password\?/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send reset code/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /send reset code/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/check the address, or contact your administrator/i),
      ).toBeInTheDocument()
    })
  })
})
