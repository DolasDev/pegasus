import React from 'react'
import { render, act } from '@testing-library/react-native'
import * as SecureStore from 'expo-secure-store'
import { AppState, type AppStateEvent, type AppStateStatus } from 'react-native'
import { AuthProvider, needsRefresh, useAuth } from './AuthContext'
import { setTokenProvider, setUnauthorizedHandler } from '../api/client'
import { logger } from '../utils/logger'
import type { Session, SignInResult, StoredRefresh } from '../auth/types'
import { AuthError } from '../auth/types'

// The API client's token provider is the thing AuthProvider must publish to.
// Spying on it lets a test read back the token the client WOULD send, without
// standing up a real fetch.
jest.mock('../api/client', () => ({
  ...jest.requireActual('../api/client'),
  setTokenProvider: jest.fn(),
  setUnauthorizedHandler: jest.fn(),
}))
const mockSetTokenProvider = setTokenProvider as jest.MockedFunction<typeof setTokenProvider>
const mockSetUnauthorizedHandler = setUnauthorizedHandler as jest.MockedFunction<
  typeof setUnauthorizedHandler
>

/** The 401 handler the API client would call right now, per the latest binding. */
function currentUnauthorizedHandler(): () => Promise<string | null> {
  const calls = mockSetUnauthorizedHandler.mock.calls
  return calls[calls.length - 1]![0]
}

/** The token the API client would attach right now, per the latest binding. */
function currentBearer(): string | null {
  const calls = mockSetTokenProvider.mock.calls
  if (calls.length === 0) return null
  return calls[calls.length - 1]![0]()
}

// Updates ctxRef.current on every render so tests always see latest state.
function TestConsumer({
  ctxRef,
}: {
  ctxRef: React.MutableRefObject<ReturnType<typeof useAuth> | null>
}) {
  ctxRef.current = useAuth()
  return null
}

const mockSession: Session = {
  sub: 'user-123',
  tenantId: 'tenant-abc',
  tenantName: 'Acme Moving Co',
  roleNames: ['driver'],
  role: 'driver',
  email: 'driver@example.com',
  expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now in seconds
  ssoProvider: null,
  token: 'mock-id-token',
}

const mockAuthService = {
  authenticate: jest.fn(),
  authenticateWithSso: jest.fn(),
  refreshSession: jest.fn(),
  revokeRefreshToken: jest.fn(),
}

/** What authService's sign-in calls resolve: the session plus the refresh token to keep. */
function signedIn(session: Session, refresh: StoredRefresh | null = null): SignInResult {
  return { session, refresh }
}

function renderWithProvider(
  authService: typeof mockAuthService = mockAuthService,
): React.MutableRefObject<ReturnType<typeof useAuth> | null> {
  const ctxRef: React.MutableRefObject<ReturnType<typeof useAuth> | null> = { current: null }
  render(
    <AuthProvider authService={authService}>
      <TestConsumer ctxRef={ctxRef} />
    </AuthProvider>,
  )
  return ctxRef
}

describe('AuthProvider', () => {
  describe('initial state', () => {
    it('has session null, isAuthenticated false, isLoading true initially, false after checkSession', async () => {
      const ctxRef = renderWithProvider()
      // isLoading starts true while checkSession runs
      expect(ctxRef.current!.isLoading).toBe(true)
      await act(async () => {})
      expect(ctxRef.current!.session).toBeNull()
      expect(ctxRef.current!.isAuthenticated).toBe(false)
      expect(ctxRef.current!.isLoading).toBe(false)
    })
  })

  describe('login — SESSION-01', () => {
    let ctxRef: React.MutableRefObject<ReturnType<typeof useAuth> | null>

    beforeEach(async () => {
      mockAuthService.authenticate.mockReset()
      ctxRef = renderWithProvider()
      await act(async () => {})
    })

    it('resolves to undefined, persists session to secure store, sets session state', async () => {
      mockAuthService.authenticate.mockResolvedValueOnce(signedIn(mockSession))
      await act(async () => {
        await expect(
          ctxRef.current!.login('driver@example.com', 'pass123', 'tenant-abc'),
        ).resolves.toBeUndefined()
      })

      expect(ctxRef.current!.session).toEqual(mockSession)
      expect(ctxRef.current!.isAuthenticated).toBe(true)
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'pegasus_session',
        JSON.stringify(mockSession),
      )
      expect(logger.logAuth).toHaveBeenCalledWith('login', 'driver@example.com')
    })

    it('persists full Session including token to secure store (SESSION-01)', async () => {
      mockAuthService.authenticate.mockResolvedValueOnce(signedIn(mockSession))
      await act(async () => {
        await ctxRef.current!.login('driver@example.com', 'pass123', 'tenant-abc')
      })

      const storedArg = (SecureStore.setItemAsync as jest.Mock).mock.calls[0]?.[1] as string
      const parsed = JSON.parse(storedArg)
      expect(parsed).toHaveProperty('sub')
      expect(parsed).toHaveProperty('tenantId')
      expect(parsed).toHaveProperty('role')
      expect(parsed).toHaveProperty('email')
      expect(parsed).toHaveProperty('expiresAt')
      expect(parsed).toHaveProperty('token')
    })

    it('throws AuthError and does not persist when authenticate rejects', async () => {
      mockAuthService.authenticate.mockRejectedValueOnce(
        new AuthError('NotAuthorizedException', 'Bad credentials'),
      )
      await act(async () => {
        await expect(
          ctxRef.current!.login('driver@example.com', 'wrongpass', 'tenant-abc'),
        ).rejects.toMatchObject({ code: 'NotAuthorizedException' })
      })

      expect(ctxRef.current!.session).toBeNull()
      expect(ctxRef.current!.isAuthenticated).toBe(false)
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled()
    })
  })

  describe('logout — SESSION-03', () => {
    it('clears secure store, resets session to null, calls logAuth', async () => {
      // Set up logged-in state first
      mockAuthService.authenticate.mockResolvedValueOnce(signedIn(mockSession))
      const ctxRef = renderWithProvider()
      await act(async () => {})
      await act(async () => {
        await ctxRef.current!.login('driver@example.com', 'pass123', 'tenant-abc')
      })
      expect(ctxRef.current!.isAuthenticated).toBe(true)

      // Logout
      await act(async () => {
        await ctxRef.current!.logout()
      })

      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('pegasus_session')
      expect(ctxRef.current!.session).toBeNull()
      expect(ctxRef.current!.isAuthenticated).toBe(false)
      expect(logger.logAuth).toHaveBeenCalledWith('logout', 'driver@example.com')
    })
  })
})

describe('checkSession — SESSION-02', () => {
  it('restores session from secure store on cold start', async () => {
    const stored: Session = {
      sub: 'user-456',
      tenantId: 'tenant-xyz',
      tenantName: 'Acme Moving Co',
      roleNames: ['driver'],
      role: 'driver',
      email: 'restored@example.com',
      expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now in seconds
      ssoProvider: null,
      token: 'stored-token',
    }
    ;(SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(JSON.stringify(stored))

    const ctxRef = renderWithProvider()
    expect(ctxRef.current!.isLoading).toBe(true) // still loading synchronously
    await act(async () => {})

    expect(ctxRef.current!.session).toEqual(stored)
    expect(ctxRef.current!.isAuthenticated).toBe(true)
    expect(ctxRef.current!.isLoading).toBe(false)
  })

  it('sets isAuthenticated false when no session in secure store', async () => {
    ;(SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null)

    const ctxRef = renderWithProvider()
    await act(async () => {})

    expect(ctxRef.current!.session).toBeNull()
    expect(ctxRef.current!.isAuthenticated).toBe(false)
    expect(ctxRef.current!.isLoading).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Session refresh — the "auto-logged-in but nothing works" fix
// ---------------------------------------------------------------------------

const nowSec = () => Math.floor(Date.now() / 1000)

function sessionWith(overrides: Partial<Session>): Session {
  return { ...mockSession, ...overrides }
}

const passwordRefresh: StoredRefresh = { refreshToken: 'rt-pw', kind: 'password' }

/**
 * SecureStore keyed stub: `pegasus_session` / `pegasus_refresh` answer from the
 * given values, so the order the provider reads them in doesn't matter.
 */
function stubStore(values: { session?: Session | null; refresh?: StoredRefresh | null }) {
  ;(SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    if (key === 'pegasus_session') return values.session ? JSON.stringify(values.session) : null
    if (key === 'pegasus_refresh') return values.refresh ? JSON.stringify(values.refresh) : null
    return null
  })
}

describe('needsRefresh', () => {
  it('is false well before expiry, true inside the 5-minute window and after expiry', () => {
    const now = Date.now()
    const at = (offsetSec: number) => sessionWith({ expiresAt: Math.floor(now / 1000) + offsetSec })
    expect(needsRefresh(at(3600), now)).toBe(false)
    expect(needsRefresh(at(240), now)).toBe(true)
    expect(needsRefresh(at(-1), now)).toBe(true)
  })
})

describe('cold start with an expired session', () => {
  beforeEach(() => {
    mockAuthService.refreshSession.mockReset()
    mockAuthService.revokeRefreshToken.mockReset()
  })
  afterEach(() => {
    ;(SecureStore.getItemAsync as jest.Mock).mockImplementation(() => Promise.resolve(null))
  })

  it('refreshes BEFORE publishing — the app opens on the new token, never the dead one', async () => {
    const expired = sessionWith({ expiresAt: nowSec() - 60, token: 'dead-token' })
    const renewed = sessionWith({ expiresAt: nowSec() + 8 * 3600, token: 'fresh-token' })
    stubStore({ session: expired, refresh: passwordRefresh })
    mockAuthService.refreshSession.mockResolvedValueOnce(signedIn(renewed, passwordRefresh))

    const onMount = jest.fn()
    function Probe() {
      const { isAuthenticated } = useAuth()
      React.useEffect(() => {
        if (isAuthenticated) onMount(currentBearer())
      }, [isAuthenticated])
      return null
    }
    const ctxRef = { current: null } as React.MutableRefObject<ReturnType<typeof useAuth> | null>
    render(
      <AuthProvider authService={mockAuthService}>
        <TestConsumer ctxRef={ctxRef} />
        <Probe />
      </AuthProvider>,
    )
    await act(async () => {})

    expect(mockAuthService.refreshSession).toHaveBeenCalledWith(expired, passwordRefresh)
    expect(ctxRef.current!.session).toEqual(renewed)
    expect(ctxRef.current!.isLoading).toBe(false)
    expect(onMount).toHaveBeenCalledTimes(1)
    expect(onMount).toHaveBeenCalledWith('fresh-token')
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'pegasus_session',
      JSON.stringify(renewed),
    )
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'pegasus_refresh',
      JSON.stringify(passwordRefresh),
    )
  })

  it('signs out with sessionExpired when the refresh is rejected (revoked, deactivated)', async () => {
    stubStore({ session: sessionWith({ expiresAt: nowSec() - 60 }), refresh: passwordRefresh })
    mockAuthService.refreshSession.mockRejectedValueOnce(
      new AuthError('NotAuthorizedException', 'Refresh Token has been revoked'),
    )

    const ctxRef = renderWithProvider()
    await act(async () => {})

    expect(ctxRef.current!.isAuthenticated).toBe(false)
    expect(ctxRef.current!.sessionExpired).toBe(true)
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('pegasus_session')
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('pegasus_refresh')
  })

  it('signs out with sessionExpired when there is no refresh token (pre-update install)', async () => {
    stubStore({ session: sessionWith({ expiresAt: nowSec() - 60 }), refresh: null })

    const ctxRef = renderWithProvider()
    await act(async () => {})

    expect(mockAuthService.refreshSession).not.toHaveBeenCalled()
    expect(ctxRef.current!.isAuthenticated).toBe(false)
    expect(ctxRef.current!.sessionExpired).toBe(true)
  })

  it('keeps the session on a transient failure (offline) — no sign-out in a dead zone', async () => {
    const expired = sessionWith({ expiresAt: nowSec() - 60, token: 'stale-token' })
    stubStore({ session: expired, refresh: passwordRefresh })
    mockAuthService.refreshSession.mockRejectedValueOnce(new TypeError('Network request failed'))

    const ctxRef = renderWithProvider()
    await act(async () => {})

    expect(ctxRef.current!.session).toEqual(expired)
    expect(ctxRef.current!.sessionExpired).toBe(false)
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled()
  })

  it('a valid session is restored without any refresh call', async () => {
    stubStore({ session: sessionWith({ expiresAt: nowSec() + 3600 }), refresh: passwordRefresh })
    renderWithProvider()
    await act(async () => {})
    expect(mockAuthService.refreshSession).not.toHaveBeenCalled()
  })
})

describe('foreground resume — SESSION-04', () => {
  let mockAppStateListeners: Array<(state: AppStateStatus) => void>

  beforeEach(() => {
    mockAuthService.refreshSession.mockReset()
    mockAppStateListeners = []
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event: AppStateEvent, handler: (state: AppStateStatus) => void) => {
        mockAppStateListeners.push(handler)
        return { remove: jest.fn() }
      })
  })
  afterEach(() => {
    jest.restoreAllMocks()
    ;(SecureStore.getItemAsync as jest.Mock).mockImplementation(() => Promise.resolve(null))
  })

  /** Restore a valid session, then move the clock past its expiry. */
  async function restoreThenExpire(): Promise<
    React.MutableRefObject<ReturnType<typeof useAuth> | null>
  > {
    const session = sessionWith({ expiresAt: nowSec() + 3600, token: 'day-old-token' })
    stubStore({ session, refresh: passwordRefresh })
    const ctxRef = renderWithProvider()
    await act(async () => {})
    expect(ctxRef.current!.isAuthenticated).toBe(true)
    const later = Date.now() + 2 * 3600 * 1000
    jest.spyOn(Date, 'now').mockReturnValue(later)
    return ctxRef
  }

  it('refreshes an expired session on return to the foreground', async () => {
    const ctxRef = await restoreThenExpire()
    const renewed = sessionWith({ expiresAt: nowSec() + 8 * 3600, token: 'fresh-token' })
    mockAuthService.refreshSession.mockResolvedValueOnce(signedIn(renewed, passwordRefresh))

    await act(async () => {
      mockAppStateListeners.forEach((fn) => fn('active'))
    })

    expect(mockAuthService.refreshSession).toHaveBeenCalledTimes(1)
    expect(ctxRef.current!.session).toEqual(renewed)
    expect(currentBearer()).toBe('fresh-token')
  })

  it('signs out with sessionExpired when the foreground refresh is rejected', async () => {
    const ctxRef = await restoreThenExpire()
    mockAuthService.refreshSession.mockRejectedValueOnce(
      new AuthError('NotAuthorizedException', 'Refresh Token has expired'),
    )

    await act(async () => {
      mockAppStateListeners.forEach((fn) => fn('active'))
    })

    expect(ctxRef.current!.isAuthenticated).toBe(false)
    expect(ctxRef.current!.sessionExpired).toBe(true)
  })

  it('does nothing on background/inactive, or when the session is still fresh', async () => {
    stubStore({ session: sessionWith({ expiresAt: nowSec() + 3600 }), refresh: passwordRefresh })
    renderWithProvider()
    await act(async () => {})

    await act(async () => {
      mockAppStateListeners.forEach((fn) => fn('background'))
      mockAppStateListeners.forEach((fn) => fn('inactive'))
      mockAppStateListeners.forEach((fn) => fn('active'))
    })

    expect(mockAuthService.refreshSession).not.toHaveBeenCalled()
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled()
  })
})

describe('401 handler (API client onUnauthorized)', () => {
  beforeEach(() => {
    mockAuthService.refreshSession.mockReset()
  })
  afterEach(() => {
    ;(SecureStore.getItemAsync as jest.Mock).mockImplementation(() => Promise.resolve(null))
  })

  it('refreshes and resolves the new token; concurrent 401s share ONE refresh', async () => {
    stubStore({ session: sessionWith({ expiresAt: nowSec() + 3600 }), refresh: passwordRefresh })
    const ctxRef = renderWithProvider()
    await act(async () => {})

    const renewed = sessionWith({ expiresAt: nowSec() + 8 * 3600, token: 'fresh-token' })
    let resolveRefresh!: (r: SignInResult) => void
    mockAuthService.refreshSession.mockReturnValueOnce(
      new Promise<SignInResult>((r) => {
        resolveRefresh = r
      }),
    )

    const handler = currentUnauthorizedHandler()
    let tokens: Array<string | null> = []
    await act(async () => {
      const all = Promise.all([handler(), handler(), handler()])
      resolveRefresh(signedIn(renewed, passwordRefresh))
      tokens = await all
    })

    expect(mockAuthService.refreshSession).toHaveBeenCalledTimes(1)
    expect(tokens).toEqual(['fresh-token', 'fresh-token', 'fresh-token'])
    expect(ctxRef.current!.session).toEqual(renewed)
  })

  it('resolves null when signed out (no session to refresh)', async () => {
    renderWithProvider()
    await act(async () => {})
    await expect(currentUnauthorizedHandler()()).resolves.toBeNull()
    expect(mockAuthService.refreshSession).not.toHaveBeenCalled()
  })

  it('a refresh that lands after sign-out does not resurrect the session', async () => {
    stubStore({ session: sessionWith({ expiresAt: nowSec() + 3600 }), refresh: passwordRefresh })
    const ctxRef = renderWithProvider()
    await act(async () => {})

    let resolveRefresh!: (r: SignInResult) => void
    mockAuthService.refreshSession.mockReturnValueOnce(
      new Promise<SignInResult>((r) => {
        resolveRefresh = r
      }),
    )
    mockAuthService.revokeRefreshToken.mockResolvedValue(undefined)

    let pending!: Promise<string | null>
    await act(async () => {
      pending = currentUnauthorizedHandler()()
    })
    await act(async () => {
      await ctxRef.current!.logout()
    })
    await act(async () => {
      resolveRefresh(signedIn(sessionWith({ token: 'late-token' }), passwordRefresh))
      await expect(pending).resolves.toBeNull()
    })

    expect(ctxRef.current!.isAuthenticated).toBe(false)
    expect(currentBearer()).toBeNull()
  })
})

describe('refresh token storage', () => {
  afterEach(() => {
    ;(SecureStore.getItemAsync as jest.Mock).mockImplementation(() => Promise.resolve(null))
  })

  it('login stores the refresh token in its own key, apart from the session', async () => {
    const ctxRef = renderWithProvider()
    await act(async () => {})
    mockAuthService.authenticate.mockResolvedValueOnce(signedIn(mockSession, passwordRefresh))

    await act(async () => {
      await ctxRef.current!.login('driver@example.com', 'pass123', 'tenant-abc')
    })

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'pegasus_refresh',
      JSON.stringify(passwordRefresh),
    )
    const sessionWrite = (SecureStore.setItemAsync as jest.Mock).mock.calls.find(
      ([key]) => key === 'pegasus_session',
    )!
    expect(sessionWrite[1]).not.toContain('rt-pw')
  })

  it('sign-in still succeeds when the refresh-token write fails (degrades to no renewal)', async () => {
    const ctxRef = renderWithProvider()
    await act(async () => {})
    mockAuthService.authenticate.mockResolvedValueOnce(signedIn(mockSession, passwordRefresh))
    ;(SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string) => {
      if (key === 'pegasus_refresh') throw new Error('value too large')
    })

    try {
      await act(async () => {
        await ctxRef.current!.login('driver@example.com', 'pass123', 'tenant-abc')
      })
      expect(ctxRef.current!.isAuthenticated).toBe(true)
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('pegasus_refresh')
    } finally {
      ;(SecureStore.setItemAsync as jest.Mock).mockImplementation(() => Promise.resolve())
    }
  })

  it('logout revokes the refresh token and clears both keys', async () => {
    stubStore({ session: sessionWith({ expiresAt: nowSec() + 3600 }), refresh: passwordRefresh })
    mockAuthService.revokeRefreshToken.mockResolvedValueOnce(undefined)
    const ctxRef = renderWithProvider()
    await act(async () => {})

    await act(async () => {
      await ctxRef.current!.logout()
    })

    expect(mockAuthService.revokeRefreshToken).toHaveBeenCalledWith(passwordRefresh)
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('pegasus_session')
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('pegasus_refresh')
    expect(ctxRef.current!.isAuthenticated).toBe(false)
    expect(ctxRef.current!.sessionExpired).toBe(false)
  })

  it('logout still signs out when the revoke fails', async () => {
    stubStore({ session: sessionWith({ expiresAt: nowSec() + 3600 }), refresh: passwordRefresh })
    mockAuthService.revokeRefreshToken.mockRejectedValueOnce(new TypeError('offline'))
    const ctxRef = renderWithProvider()
    await act(async () => {})

    await act(async () => {
      await ctxRef.current!.logout()
    })

    expect(ctxRef.current!.isAuthenticated).toBe(false)
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('pegasus_refresh')
  })

  it('a new login clears sessionExpired', async () => {
    stubStore({ session: sessionWith({ expiresAt: nowSec() - 60 }), refresh: null })
    const ctxRef = renderWithProvider()
    await act(async () => {})
    expect(ctxRef.current!.sessionExpired).toBe(true)

    mockAuthService.authenticate.mockResolvedValueOnce(signedIn(mockSession, passwordRefresh))
    await act(async () => {
      await ctxRef.current!.login('driver@example.com', 'pass123', 'tenant-abc')
    })

    expect(ctxRef.current!.sessionExpired).toBe(false)
    expect(ctxRef.current!.isAuthenticated).toBe(true)
  })
})

describe('loginWithSso — SSO authentication', () => {
  let ctxRef: React.MutableRefObject<ReturnType<typeof useAuth> | null>

  beforeEach(async () => {
    mockAuthService.authenticateWithSso.mockReset()
    ctxRef = renderWithProvider()
    await act(async () => {})
  })

  it('resolves to undefined, persists session to secure store, sets session state', async () => {
    mockAuthService.authenticateWithSso.mockResolvedValueOnce(signedIn(mockSession))
    await act(async () => {
      await expect(ctxRef.current!.loginWithSso('tenant-abc', 'GoogleSSO')).resolves.toBeUndefined()
    })

    expect(ctxRef.current!.session).toEqual(mockSession)
    expect(ctxRef.current!.isAuthenticated).toBe(true)
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'pegasus_session',
      JSON.stringify(mockSession),
    )
    expect(logger.logAuth).toHaveBeenCalledWith('login', 'driver@example.com')
  })

  it('persists full Session including token to secure store', async () => {
    mockAuthService.authenticateWithSso.mockResolvedValueOnce(signedIn(mockSession))
    await act(async () => {
      await ctxRef.current!.loginWithSso('tenant-abc', 'GoogleSSO')
    })

    const storedArg = (SecureStore.setItemAsync as jest.Mock).mock.calls[0]?.[1] as string
    const parsed = JSON.parse(storedArg)
    expect(parsed).toHaveProperty('sub')
    expect(parsed).toHaveProperty('tenantId')
    expect(parsed).toHaveProperty('token')
  })

  it('throws AuthError and does not persist when authenticateWithSso rejects', async () => {
    mockAuthService.authenticateWithSso.mockRejectedValueOnce(
      new AuthError('UserCancelled', 'SSO login cancelled'),
    )
    await act(async () => {
      await expect(ctxRef.current!.loginWithSso('tenant-abc', 'GoogleSSO')).rejects.toMatchObject({
        code: 'UserCancelled',
      })
    })

    expect(ctxRef.current!.session).toBeNull()
    expect(ctxRef.current!.isAuthenticated).toBe(false)
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled()
  })
})

describe('API bearer-token binding', () => {
  // Regression: the token used to be bound by a useEffect in the root layout,
  // which is a PARENT of the authenticated screens. React flushes child effects
  // before parent effects, so the first authenticated request of a cold start —
  // TripsProvider's GET /me/driver, fired from its own mount effect — went out
  // with no Authorization header and the driver saw "Couldn't load your driver"
  // until they hit Retry. These tests pin the invariant that makes that
  // impossible: a descendant mounted on the commit where the session appears
  // already sees the token.

  /** Stands in for TripsProvider: reads the bearer from its mount effect. */
  function ProtectedProbe({ onMount }: { onMount: (token: string | null) => void }) {
    React.useEffect(() => {
      onMount(currentBearer())
    }, [onMount])
    return null
  }

  /** Mounts the probe only once authenticated, exactly like Stack.Protected. */
  function ProtectedTree({ onMount }: { onMount: (token: string | null) => void }) {
    const { isAuthenticated } = useAuth()
    return isAuthenticated ? <ProtectedProbe onMount={onMount} /> : null
  }

  it('a screen mounted by a restored session sees the token in its own mount effect', async () => {
    const stored: Session = { ...mockSession, token: 'restored-token' }
    ;(SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(JSON.stringify(stored))
    const onMount = jest.fn()

    render(
      <AuthProvider authService={mockAuthService}>
        <ProtectedTree onMount={onMount} />
      </AuthProvider>,
    )
    await act(async () => {})

    expect(onMount).toHaveBeenCalledTimes(1)
    expect(onMount).toHaveBeenCalledWith('restored-token')
  })

  it('a screen mounted by a fresh login sees the token in its own mount effect', async () => {
    ;(SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null)
    mockAuthService.authenticate.mockResolvedValueOnce(
      signedIn({ ...mockSession, token: 'login-token' }),
    )
    const onMount = jest.fn()
    const ctxRef: React.MutableRefObject<ReturnType<typeof useAuth> | null> = { current: null }

    render(
      <AuthProvider authService={mockAuthService}>
        <TestConsumer ctxRef={ctxRef} />
        <ProtectedTree onMount={onMount} />
      </AuthProvider>,
    )
    await act(async () => {})
    expect(onMount).not.toHaveBeenCalled()

    await act(async () => {
      await ctxRef.current!.login('driver@example.com', 'pass123', 'tenant-abc')
    })

    expect(onMount).toHaveBeenCalledWith('login-token')
  })

  it('stops sending the token after logout', async () => {
    ;(SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockSession))
    const ctxRef = renderWithProvider()
    await act(async () => {})
    expect(currentBearer()).toBe(mockSession.token)

    await act(async () => {
      await ctxRef.current!.logout()
    })

    expect(currentBearer()).toBeNull()
  })
})

describe('useAuth', () => {
  it('throws when used outside AuthProvider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    function BareConsumer() {
      useAuth()
      return null
    }
    expect(() => render(<BareConsumer />)).toThrow('useAuth must be used within an AuthProvider')
    spy.mockRestore()
  })
})
