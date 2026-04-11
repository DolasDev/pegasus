import { describe, it, expect, vi, afterEach } from 'vitest'
import { isSessionExpired, type Session } from '../session'

afterEach(() => {
  vi.restoreAllMocks()
})

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sub: 'user-sub-123',
    tenantId: 'tenant-1',
    role: 'tenant_user',
    email: 'user@example.com',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ssoProvider: null,
    ...overrides,
  }
}

describe('isSessionExpired', () => {
  it('returns false for a session that expires in the future', () => {
    const session = makeSession({ expiresAt: Math.floor(Date.now() / 1000) + 3600 })
    expect(isSessionExpired(session)).toBe(false)
  })

  it('returns true for a session that expired in the past', () => {
    const session = makeSession({ expiresAt: Math.floor(Date.now() / 1000) - 60 })
    expect(isSessionExpired(session)).toBe(true)
  })

  it('returns true for a session that expires exactly now', () => {
    const now = Math.floor(Date.now() / 1000)
    vi.spyOn(Date, 'now').mockReturnValue(now * 1000)
    const session = makeSession({ expiresAt: now })
    expect(isSessionExpired(session)).toBe(true)
  })
})
