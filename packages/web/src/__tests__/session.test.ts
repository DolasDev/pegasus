import { setSession, getSession, clearSession, type Session } from '../auth/session'

const makeSession = (overrides?: Partial<Session>): Session => ({
  sub: 'user-123',
  tenantId: 'tenant-456',
  role: 'tenant_admin',
  email: 'test@example.com',
  expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
  ssoProvider: null,
  token: 'id-token-abc',
  ...overrides,
})

beforeEach(() => {
  clearSession()
})

describe('setSession', () => {
  it('writes the session to sessionStorage', () => {
    setSession(makeSession())
    expect(getSession()).not.toBeNull()
  })
})

describe('getSession', () => {
  it('returns null when nothing is stored', () => {
    expect(getSession()).toBeNull()
  })

  it('returns the stored session after setSession()', () => {
    const session = makeSession()
    setSession(session)
    expect(getSession()).toEqual(session)
  })

  it('returns null for an expired session', () => {
    setSession(makeSession({ expiresAt: Math.floor(Date.now() / 1000) - 1 }))
    expect(getSession()).toBeNull()
  })
})

describe('clearSession', () => {
  it('removes the stored session', () => {
    setSession(makeSession())
    clearSession()
    expect(getSession()).toBeNull()
  })
})
