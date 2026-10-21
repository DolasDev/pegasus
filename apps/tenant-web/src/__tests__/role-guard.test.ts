import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the session module before importing the guard
vi.mock('@/auth/session', () => ({
  getSession: vi.fn(),
}))

import { requireRole, OPERATIONS_ROLES } from '@/auth/role-guard'
import { getSession } from '@/auth/session'
import type { Session } from '@/auth/session'

const mockedGetSession = vi.mocked(getSession)

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sub: 'user-1',
    tenantId: 'tenant-1',
    tenantName: 'Tenant One',
    roleNames: ['tenant_admin'],
    role: 'tenant_admin',
    email: 'admin@example.com',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ssoProvider: null,
    token: 'tok',
    ...overrides,
  }
}

describe('requireRole', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to /login when there is no session', () => {
    mockedGetSession.mockReturnValue(null)

    const guard = requireRole('tenant_admin')
    try {
      guard()
      expect.fail('Expected requireRole to throw')
    } catch (err) {
      expect(err).toMatchObject({ options: { to: '/login' } })
    }
  })

  it('passes through when the session has the allowed role', () => {
    mockedGetSession.mockReturnValue(makeSession({ roleNames: ['tenant_admin'] }))

    expect(() => requireRole('tenant_admin')()).not.toThrow()
  })

  it('redirects to /dashboard when the session has only non-admin roles', () => {
    mockedGetSession.mockReturnValue(makeSession({ roleNames: ['long_distance_dispatch'] }))

    try {
      requireRole('tenant_admin')()
      expect.fail('Expected requireRole to throw')
    } catch (err) {
      expect(err).toMatchObject({ options: { to: '/dashboard' } })
    }
  })

  it('passes through when at least one of the session roles is allowed', () => {
    mockedGetSession.mockReturnValue(makeSession({ roleNames: ['driver', 'tenant_admin'] }))

    expect(() => requireRole('tenant_admin')()).not.toThrow()
  })

  it('redirects to /dashboard when roleNames is empty', () => {
    mockedGetSession.mockReturnValue(makeSession({ roleNames: [] }))

    try {
      requireRole('tenant_admin')()
      expect.fail('Expected requireRole to throw')
    } catch (err) {
      expect(err).toMatchObject({ options: { to: '/dashboard' } })
    }
  })

  it('accepts a variadic list of allowed roles', () => {
    mockedGetSession.mockReturnValue(makeSession({ roleNames: ['operations_admin'] }))

    expect(() => requireRole('tenant_admin', 'operations_admin')()).not.toThrow()
  })

  it('rejects when none of the allowed roles match', () => {
    mockedGetSession.mockReturnValue(makeSession({ roleNames: ['sales'] }))

    try {
      requireRole('tenant_admin', 'operations_admin')()
      expect.fail('Expected requireRole to throw')
    } catch (err) {
      expect(err).toMatchObject({ options: { to: '/dashboard' } })
    }
  })
})

describe('OPERATIONS_ROLES', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The Operations routes in router.tsx spread this const into requireRole, and
  // AppShell gates the matching nav entries on the same const. These pin the
  // grant itself: dropping a role here silently hides four screens from it.
  it.each([
    'tenant_admin',
    'operations_admin',
    'long_distance_dispatch',
    'central_planning_dispatch',
  ])('admits %s to the Operations routes', (role) => {
    mockedGetSession.mockReturnValue(makeSession({ roleNames: [role] }))

    expect(() => requireRole(...OPERATIONS_ROLES)()).not.toThrow()
  })

  it('still turns away a role outside the section', () => {
    mockedGetSession.mockReturnValue(makeSession({ roleNames: ['sales'] }))

    try {
      requireRole(...OPERATIONS_ROLES)()
      expect.fail('Expected requireRole to throw')
    } catch (err) {
      expect(err).toMatchObject({ options: { to: '/dashboard' } })
    }
  })
})
