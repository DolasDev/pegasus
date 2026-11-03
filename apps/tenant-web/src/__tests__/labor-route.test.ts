import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/auth/session', () => ({ getSession: vi.fn() }))

import { router } from '@/router'
import { getSession } from '@/auth/session'
import type { Session } from '@/auth/session'

const mockedGetSession = vi.mocked(getSession)

function sessionWith(roleNames: string[]): Session {
  return {
    sub: 'user-1',
    tenantId: 'tenant-1',
    tenantName: 'Tenant One',
    roleNames,
    role: roleNames[0] ?? '',
    email: 'u@example.com',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ssoProvider: null,
    token: 'tok',
  } as Session
}

// /driver-planning/labor is the company crew list: Operations-only, like its
// siblings (the nav entry in AppShell is covered by AppShell.test.tsx).
describe('/driver-planning/labor route guard', () => {
  const route = router.routesByPath['/driver-planning/labor' as keyof typeof router.routesByPath]
  const beforeLoad = (route as unknown as { options: { beforeLoad?: () => void } }).options
    .beforeLoad

  beforeEach(() => vi.clearAllMocks())

  it('is registered with a guard', () => {
    expect(beforeLoad).toBeTypeOf('function')
  })

  it.each(['operations_admin', 'tenant_admin', 'long_distance_dispatch'])('admits %s', (role) => {
    mockedGetSession.mockReturnValue(sessionWith([role]))
    expect(() => beforeLoad!()).not.toThrow()
  })

  it('redirects a role outside Operations to /dashboard', () => {
    mockedGetSession.mockReturnValue(sessionWith(['sales']))
    try {
      beforeLoad!()
      expect.fail('Expected the guard to throw')
    } catch (err) {
      expect(err).toMatchObject({ options: { to: '/dashboard' } })
    }
  })
})
