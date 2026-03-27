import React from 'react'
import { render, act } from '@testing-library/react-native'
import * as SecureStore from 'expo-secure-store'
import { AppState } from 'react-native'
import { AuthProvider, useAuth } from './AuthContext'
import { logger } from '../utils/logger'
import type { Session } from '../auth/types'

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
  expiresAt: Date.now() + 3600_000, // 1 hour from now
}

const mockAuthService = {
  authenticate: jest.fn(),
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

    it('returns true, persists session to secure store, sets session state', async () => {
      mockAuthService.authenticate.mockResolvedValueOnce(mockSession)
      let result = false
      await act(async () => {
        result = await ctxRef.current!.login('driver@example.com', 'pass123', 'tenant-abc')
      })

      expect(result).toBe(true)
      expect(ctxRef.current!.session).toEqual(mockSession)
      expect(ctxRef.current!.isAuthenticated).toBe(true)
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'pegasus_session',
        JSON.stringify(mockSession),
      )
      expect(logger.logAuth).toHaveBeenCalledWith('login', 'driver@example.com')
    })

    it('does NOT store raw tokens — only Session object fields are persisted (SESSION-01)', async () => {
      mockAuthService.authenticate.mockResolvedValueOnce(mockSession)
      await act(async () => {
        await ctxRef.current!.login('driver@example.com', 'pass123', 'tenant-abc')
      })

      const storedArg = (SecureStore.setItemAsync as jest.Mock).mock.calls[0]?.[1] as string
      const parsed = JSON.parse(storedArg)
      // Session must not contain any token field
      expect(parsed).not.toHaveProperty('idToken')
      expect(parsed).not.toHaveProperty('token')
      expect(parsed).not.toHaveProperty('accessToken')
      expect(parsed).not.toHaveProperty('refreshToken')
      // Must contain exactly the Session fields
      expect(parsed).toHaveProperty('sub')
      expect(parsed).toHaveProperty('tenantId')
      expect(parsed).toHaveProperty('role')
      expect(parsed).toHaveProperty('email')
      expect(parsed).toHaveProperty('expiresAt')
    })

    it('returns false and does not persist when authenticate rejects', async () => {
      mockAuthService.authenticate.mockRejectedValueOnce(
        new Error('NotAuthorizedException'),
      )
      let result = true
      await act(async () => {
        result = await ctxRef.current!.login('driver@example.com', 'wrongpass', 'tenant-abc')
      })

      expect(result).toBe(false)
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
