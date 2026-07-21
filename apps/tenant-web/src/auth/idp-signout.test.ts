// ---------------------------------------------------------------------------
// The two-leg sign-out chain. See auth/idp-signout.ts for why it runs
// Cognito-first and what each leg is responsible for.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SIGNED_OUT_PATH,
  buildCognitoLogoutUrl,
  buildIdpSignOutUrl,
  consumePendingIdpSignOut,
  fetchIdpSignOutUrl,
  startIdpSignOut,
} from './idp-signout'

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }))

vi.mock('@/api/client', () => ({ apiFetch: mockApiFetch }))

vi.mock('@/auth/cognito', () => ({
  getCognitoConfig: vi.fn(() => ({
    region: 'us-east-1',
    userPoolId: 'us-east-1_test',
    clientId: 'test-client-id',
    domain: 'https://auth.test',
    redirectUri: 'https://app.test/login/callback',
  })),
}))

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { origin: 'https://app.test', href: '', replace: vi.fn() },
  })
})

const CONFIG = {
  region: 'us-east-1',
  userPoolId: 'us-east-1_test',
  clientId: 'test-client-id',
  domain: 'https://auth.test',
  redirectUri: 'https://app.test/login/callback',
}

describe('buildCognitoLogoutUrl', () => {
  it('returns to the registered sign-out landing route, not straight to /login', () => {
    // Cognito only accepts a logout_uri registered on the app client, and the
    // chain needs a page of ours to run the second leg from.
    const url = new URL(buildCognitoLogoutUrl(CONFIG, SIGNED_OUT_PATH))

    expect(url.origin + url.pathname).toBe('https://auth.test/logout')
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('logout_uri')).toBe('https://app.test/login/signed-out')
  })
})

describe('buildIdpSignOutUrl', () => {
  it('asks the IdP to return the user to /login', () => {
    const url = new URL(
      buildIdpSignOutUrl('https://login.microsoftonline.com/t/oauth2/v2.0/logout'),
    )

    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://app.test/login')
  })

  it('preserves query parameters the IdP already put on its endpoint', () => {
    const url = new URL(buildIdpSignOutUrl('https://idp.test/logout?tenant=acme'))

    expect(url.searchParams.get('tenant')).toBe('acme')
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://app.test/login')
  })
})

describe('fetchIdpSignOutUrl', () => {
  it('returns the URL the backend resolved', async () => {
    mockApiFetch.mockResolvedValue({ signOutUrl: 'https://idp.test/logout' })

    await expect(fetchIdpSignOutUrl('t1', 'AcmeOkta')).resolves.toBe('https://idp.test/logout')
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/auth/idp-sign-out-url',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('degrades to null when the lookup fails — this is already an error path', async () => {
    mockApiFetch.mockRejectedValue(new Error('offline'))

    await expect(fetchIdpSignOutUrl('t1', 'AcmeOkta')).resolves.toBeNull()
  })
})

describe('startIdpSignOut', () => {
  it('stashes the IdP URL for leg two, then navigates to Cognito logout', async () => {
    mockApiFetch.mockResolvedValue({ signOutUrl: 'https://idp.test/logout' })

    await startIdpSignOut('t1', 'AcmeOkta')

    expect(window.location.href).toBe(
      'https://auth.test/logout?client_id=test-client-id&logout_uri=https%3A%2F%2Fapp.test%2Flogin%2Fsigned-out',
    )
    expect(consumePendingIdpSignOut()).toBe('https://idp.test/logout')
  })

  it('still clears the Cognito session when the IdP has no sign-out endpoint', async () => {
    mockApiFetch.mockResolvedValue({ signOutUrl: null })

    await startIdpSignOut('t1', 'AcmeSaml')

    expect(window.location.href).toContain('https://auth.test/logout')
    expect(consumePendingIdpSignOut()).toBeNull()
  })

  it('does not leave a stale IdP URL behind from an earlier attempt', async () => {
    sessionStorage.setItem('pegasus.sso.pendingIdpSignOut', 'https://stale.test/logout')
    mockApiFetch.mockResolvedValue({ signOutUrl: null })

    await startIdpSignOut('t1', 'AcmeSaml')

    expect(consumePendingIdpSignOut()).toBeNull()
  })
})

describe('consumePendingIdpSignOut', () => {
  it('is single-use — a refresh of the landing page must not redirect twice', () => {
    sessionStorage.setItem('pegasus.sso.pendingIdpSignOut', 'https://idp.test/logout')

    expect(consumePendingIdpSignOut()).toBe('https://idp.test/logout')
    expect(consumePendingIdpSignOut()).toBeNull()
  })

  it('refuses a non-https value — it is about to become a top-level navigation', () => {
    sessionStorage.setItem('pegasus.sso.pendingIdpSignOut', 'javascript:alert(1)')

    expect(consumePendingIdpSignOut()).toBeNull()
  })

  it('returns null when nothing is pending', () => {
    expect(consumePendingIdpSignOut()).toBeNull()
  })
})
