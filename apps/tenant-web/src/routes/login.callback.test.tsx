// ---------------------------------------------------------------------------
// LoginCallbackPage — wrong-account detection and recovery.
//
// Covers all three ways a federated sign-in lands on the wrong person (see the
// comment block in login.callback.tsx), plus the guarantee that ordinary
// failures and ordinary successes are untouched by any of it.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SSO_ERROR_NO_EMAIL, SSO_ERROR_NOT_ROSTERED } from '@pegasus/domain'
import { LoginCallbackPage } from './login.callback'
import { saveSsoContext, readSsoContext } from '@/auth/sso-context'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockExchange, mockApiFetch, mockSetSession, mockConsumePkceState, mockStartIdpSignOut } =
  vi.hoisted(() => ({
    mockExchange: vi.fn(),
    mockApiFetch: vi.fn(),
    mockSetSession: vi.fn(),
    mockConsumePkceState: vi.fn(),
    mockStartIdpSignOut: vi.fn(),
  }))

vi.mock('@/auth/cognito', () => ({
  getCognitoConfig: vi.fn(() => ({
    region: 'us-east-1',
    userPoolId: 'us-east-1_test',
    clientId: 'test-client-id',
    domain: 'https://auth.test',
    redirectUri: 'https://app.test/login/callback',
  })),
  exchangeCodeForTokens: mockExchange,
}))

vi.mock('@/auth/pkce', () => ({ consumePkceState: mockConsumePkceState }))
vi.mock('@/auth/session', () => ({ setSession: mockSetSession }))
vi.mock('@/auth/idp-signout', () => ({ startIdpSignOut: mockStartIdpSignOut }))

vi.mock('@/api/client', () => ({
  apiFetch: mockApiFetch,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONTEXT = {
  email: 'vdivito@reliablevan.com',
  tenantId: 'tenant-reliable',
  providerId: 'microsoft-reliable',
  providerName: 'Reliable Microsoft',
}

/** Points window.location at a callback URL with the given query string. */
function atCallback(query: string) {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: {
      search: query,
      origin: 'https://app.test',
      href: 'https://app.test/login/callback',
      replace: vi.fn(),
    },
  })
}

/** A successful code exchange + backend validation returning the given email. */
function signsInAs(email: string) {
  mockConsumePkceState.mockReturnValue('verifier')
  mockExchange.mockResolvedValue({ id_token: 'id-token' })
  mockApiFetch.mockResolvedValue({
    sub: 'sub-1',
    tenantId: 'tenant-reliable',
    email,
    roles: ['viewer'],
    expiresAt: Date.now() + 3_600_000,
  })
}

/** The error_description Cognito produces when our Lambda throws. */
function cognitoError(marker: string): string {
  return encodeURIComponent(
    `PreTokenGeneration failed with error Authentication failed: something. [${marker}]. ` +
      '(Service: AWSCognitoIdentityProviderInternalService; Status Code: 400)',
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

afterEach(() => {
  sessionStorage.clear()
})

// ---------------------------------------------------------------------------
// Case 1 + 2 — the pre-token Lambda rejected the sign-in and marked why
// ---------------------------------------------------------------------------

describe('LoginCallbackPage — rejected federated sign-in', () => {
  it.each([
    ['no email asserted', SSO_ERROR_NO_EMAIL],
    ['email not on the roster', SSO_ERROR_NOT_ROSTERED],
  ])('offers the IdP sign-out when the IdP %s', async (_label, marker) => {
    saveSsoContext(CONTEXT)
    atCallback(`?error=invalid_request&error_description=${cognitoError(marker)}`)

    render(<LoginCallbackPage />)

    expect(await screen.findByText('Wrong account')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /sign out of Reliable Microsoft and try again/i }),
    ).toBeInTheDocument()
  })

  it('names the account the user asked for, so they can see the mismatch', async () => {
    saveSsoContext(CONTEXT)
    atCallback(`?error=invalid_request&error_description=${cognitoError(SSO_ERROR_NOT_ROSTERED)}`)

    render(<LoginCallbackPage />)

    expect(await screen.findByText(/vdivito@reliablevan\.com/)).toBeInTheDocument()
  })

  it('never shows the raw AWS exception text', async () => {
    saveSsoContext(CONTEXT)
    atCallback(`?error=invalid_request&error_description=${cognitoError(SSO_ERROR_NO_EMAIL)}`)

    render(<LoginCallbackPage />)

    await screen.findByText('Wrong account')
    expect(screen.queryByText(/PreTokenGeneration failed/)).not.toBeInTheDocument()
    expect(screen.queryByText(/AWSCognitoIdentityProviderInternalService/)).not.toBeInTheDocument()
  })

  it('starts the sign-out chain for the right tenant and provider when clicked', async () => {
    saveSsoContext(CONTEXT)
    atCallback(`?error=invalid_request&error_description=${cognitoError(SSO_ERROR_NO_EMAIL)}`)

    render(<LoginCallbackPage />)
    fireEvent.click(await screen.findByRole('button', { name: /sign out of/i }))

    await waitFor(() =>
      expect(mockStartIdpSignOut).toHaveBeenCalledWith('tenant-reliable', 'microsoft-reliable'),
    )
    // The next login must not inherit this one's context.
    expect(readSsoContext()).toBeNull()
  })

  it('falls back to the generic error when there is no login context to explain', async () => {
    // No saveSsoContext — e.g. the user opened the callback URL in a fresh tab.
    atCallback(`?error=invalid_request&error_description=${cognitoError(SSO_ERROR_NO_EMAIL)}`)

    render(<LoginCallbackPage />)

    expect(await screen.findByText('Sign-in failed')).toBeInTheDocument()
    expect(screen.queryByText('Wrong account')).not.toBeInTheDocument()
  })

  it('leaves unmarked Cognito errors on the generic path', async () => {
    saveSsoContext(CONTEXT)
    atCallback('?error=access_denied&error_description=User%20canceled%20at%20IdP')

    render(<LoginCallbackPage />)

    expect(await screen.findByText('Sign-in failed')).toBeInTheDocument()
    expect(screen.queryByText('Wrong account')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Case 3 — nothing failed; the IdP just authenticated somebody else who is
// ALSO on this tenant's roster. Only the typed email can catch this.
// ---------------------------------------------------------------------------

describe('LoginCallbackPage — silently signed in as the wrong person', () => {
  it('refuses the session when the IdP returned a different account', async () => {
    saveSsoContext(CONTEXT)
    atCallback('?code=abc&state=xyz')
    signsInAs('someone.else@reliablevan.com')

    render(<LoginCallbackPage />)

    expect(await screen.findByText('Wrong account')).toBeInTheDocument()
    expect(mockSetSession).not.toHaveBeenCalled()
    expect(window.location.replace).not.toHaveBeenCalled()
  })

  it('names both accounts so the user understands what happened', async () => {
    saveSsoContext(CONTEXT)
    atCallback('?code=abc&state=xyz')
    signsInAs('someone.else@reliablevan.com')

    render(<LoginCallbackPage />)

    expect(await screen.findByText(/someone\.else@reliablevan\.com/)).toBeInTheDocument()
    expect(screen.getByText(/vdivito@reliablevan\.com/)).toBeInTheDocument()
  })

  it('accepts the session when the emails differ only by case', async () => {
    saveSsoContext(CONTEXT)
    atCallback('?code=abc&state=xyz')
    signsInAs('VDivito@ReliableVan.com')

    render(<LoginCallbackPage />)

    await waitFor(() => expect(mockSetSession).toHaveBeenCalled())
    expect(screen.queryByText('Wrong account')).not.toBeInTheDocument()
  })

  it('accepts the session and clears the context on a matching sign-in', async () => {
    saveSsoContext(CONTEXT)
    atCallback('?code=abc&state=xyz')
    signsInAs('vdivito@reliablevan.com')

    render(<LoginCallbackPage />)

    await waitFor(() => expect(mockSetSession).toHaveBeenCalled())
    expect(readSsoContext()).toBeNull()
    expect(window.location.replace).toHaveBeenCalledWith('/dashboard')
  })

  it('does not second-guess a password login, which has no SSO context', async () => {
    // No saveSsoContext — a native login never went through an IdP, so there is
    // nothing to compare against and nothing to sign out of.
    atCallback('?code=abc&state=xyz')
    signsInAs('whoever@reliablevan.com')

    render(<LoginCallbackPage />)

    await waitFor(() => expect(mockSetSession).toHaveBeenCalled())
    expect(screen.queryByText('Wrong account')).not.toBeInTheDocument()
  })
})
