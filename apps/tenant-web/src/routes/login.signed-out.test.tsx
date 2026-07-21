// ---------------------------------------------------------------------------
// LoginSignedOutPage — leg two of the sign-out chain.
//
// Cognito lands here after clearing its own session. The page must always move
// on: forwarding to the IdP when there is one to sign out of, and to /login when
// there is not. It is never a place a user can get stuck.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { LoginSignedOutPage } from './login.signed-out'

const { mockConsume, mockBuild } = vi.hoisted(() => ({
  mockConsume: vi.fn(),
  mockBuild: vi.fn(),
}))

vi.mock('@/auth/idp-signout', () => ({
  consumePendingIdpSignOut: mockConsume,
  buildIdpSignOutUrl: mockBuild,
}))

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { origin: 'https://app.test', href: '', replace: vi.fn() },
  })
})

describe('LoginSignedOutPage', () => {
  it('forwards to the IdP sign-out when one is pending', async () => {
    mockConsume.mockReturnValue('https://idp.test/logout')
    mockBuild.mockReturnValue('https://idp.test/logout?post_logout_redirect_uri=x')

    render(<LoginSignedOutPage />)

    await waitFor(() =>
      expect(window.location.replace).toHaveBeenCalledWith(
        'https://idp.test/logout?post_logout_redirect_uri=x',
      ),
    )
  })

  it('continues to /login when there is no IdP to sign out of', async () => {
    mockConsume.mockReturnValue(null)

    render(<LoginSignedOutPage />)

    await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/login'))
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it('replaces rather than pushes, so Back does not re-enter the chain', async () => {
    mockConsume.mockReturnValue(null)

    render(<LoginSignedOutPage />)

    await waitFor(() => expect(window.location.replace).toHaveBeenCalled())
    expect(window.location.href).toBe('')
  })
})
