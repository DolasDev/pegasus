import React from 'react'
import { render, act } from '@testing-library/react-native'
import * as SecureStore from 'expo-secure-store'
import { AppState } from 'react-native'
import { AuthProvider, useAuth } from './AuthContext'
import { logger } from '../utils/logger'
import type { Session } from '../auth/types'
import { AuthError } from '../auth/types'

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
  role: 'driver',
  email: 'driver@example.com',
  expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now in seconds
  ssoProvider: null,
  token: 'mock-id-token',
}

const mockAuthService = {
  authenticate: jest.fn(),
  authenticateWithSso: jest.fn(),
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
      mockAuthService.authenticate.mockResolvedValueOnce(mockSession)
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
      mockAuthService.authenticate.mockResolvedValueOnce(mockSession)
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
      mockAuthService.authenticate.mockResolvedValueOnce(mockSession)
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

describe('AppState expiry detection — SESSION-04', () => {
  let mockAppStateListeners: Array<(state: string) => void>

  beforeEach(() => {
    mockAppStateListeners = []
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event: string, handler: (state: string) => void) => {
        mockAppStateListeners.push(handler)
        return { remove: jest.fn() }
      })
  })

  it('calls logout when app returns to foreground with expired session', async () => {
    const expiredSession: Session = {
      sub: 'user-789',
      tenantId: 'tenant-abc',
      role: 'driver',
      email: 'expired@example.com',
      expiresAt: Math.floor(Date.now() / 1000) - 1, // 1 second ago in seconds
      ssoProvider: null,
      token: 'expired-token',
    }
    ;(SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(JSON.stringify(expiredSession))

    const ctxRef = renderWithProvider()
    await act(async () => {})

    expect(ctxRef.current!.isAuthenticated).toBe(true) // session loaded

    // Simulate foreground resume
    await act(async () => {
      mockAppStateListeners.forEach((fn) => fn('active'))
    })

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('pegasus_session')
    expect(ctxRef.current!.session).toBeNull()
    expect(ctxRef.current!.isAuthenticated).toBe(false)
  })

  it('does NOT logout when app returns to foreground with valid (non-expired) session', async () => {
    const validSession: Session = {
      sub: 'user-789',
      tenantId: 'tenant-abc',
      role: 'driver',
      email: 'valid@example.com',
      expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now in seconds
      ssoProvider: null,
      token: 'valid-token',
    }
    ;(SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(JSON.stringify(validSession))

    const ctxRef = renderWithProvider()
    await act(async () => {})

    await act(async () => {
      mockAppStateListeners.forEach((fn) => fn('active'))
    })

    expect(ctxRef.current!.isAuthenticated).toBe(true) // still authenticated
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled()
  })

  it('does NOT logout on background or inactive state changes', async () => {
    const expiredSession: Session = {
      sub: 'user-789',
      tenantId: 'tenant-abc',
      role: 'driver',
      email: 'expired@example.com',
      expiresAt: Math.floor(Date.now() / 1000) - 1, // 1 second ago in seconds
      ssoProvider: null,
      token: 'expired-token-2',
    }
    ;(SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(JSON.stringify(expiredSession))

    const ctxRef = renderWithProvider()
    await act(async () => {})

    await act(async () => {
      mockAppStateListeners.forEach((fn) => fn('background'))
      mockAppStateListeners.forEach((fn) => fn('inactive'))
    })

    // logout not triggered — only 'active' triggers expiry check
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled()
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
    mockAuthService.authenticateWithSso.mockResolvedValueOnce(mockSession)
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
    mockAuthService.authenticateWithSso.mockResolvedValueOnce(mockSession)
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
