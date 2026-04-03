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
  resolveTenantByDomain: vi.fn(),
  resolveTenantsForEmail: vi.fn(),
  selectTenant: vi.fn(),
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
      expect(screen.getByText('Choose your organisation')).toBeInTheDocument()
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
      expect(screen.queryByText('Choose your organisation')).not.toBeInTheDocument()
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
