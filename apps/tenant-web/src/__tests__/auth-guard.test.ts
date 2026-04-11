import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the session module before importing the guard
vi.mock('@/auth/session', () => ({
  getSession: vi.fn(),
}))

import { authGuard } from '@/auth/guard'
import { getSession } from '@/auth/session'

const mockedGetSession = vi.mocked(getSession)

describe('authGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws a redirect to /login when session is null', () => {
    mockedGetSession.mockReturnValue(null)

    try {
      authGuard()
      expect.fail('Expected authGuard to throw')
    } catch (err) {
      // TanStack Router redirect() throws a Response with options.to
      expect(err).toMatchObject({ options: { to: '/login' } })
    }
  })

  it('does not throw when a valid session exists', () => {
    mockedGetSession.mockReturnValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      role: 'tenant_admin',
      email: 'admin@example.com',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      ssoProvider: null,
      token: 'tok',
    })

    expect(() => authGuard()).not.toThrow()
  })
})
