import React, { createContext, useCallback, useContext, useState, useEffect } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import type { Session } from '../auth/types'
import { setTokenProvider } from '../api/client'
import { logger } from '../utils/logger'
import { storage } from '../utils/storage'
import { unregisterForPush } from '../services/pushNotifications'

const SESSION_KEY = 'pegasus_session'

interface AuthContextType {
  session: Session | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string, tenantId: string) => Promise<void>
  loginWithSso: (tenantId: string, providerId: string) => Promise<void>
  logout: () => Promise<void>
}

type AuthProviderProps = {
  authService: {
    authenticate(email: string, password: string, tenantId: string): Promise<Session>
    authenticateWithSso(tenantId: string, providerId: string): Promise<Session>
  }
  children: React.ReactNode
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<AuthProviderProps> = ({ authService, children }) => {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Derived — never stored as separate useState to avoid sync issues (D-03)
  const isAuthenticated = session !== null

  // Publish the session to React state AND to the API client's bearer-token
  // provider in the same synchronous step. Every transition goes through here.
  //
  // The token binding used to live in a `useEffect([session])` in the root
  // layout, which is one commit too late: `TripsProvider` mounts as a
  // *descendant* of that layout, and React flushes child effects before parent
  // effects. So on the very commit where the session appears — cold-start
  // restore and fresh login alike — the first `GET /me/driver` went out through
  // the previous (null) provider with no Authorization header, and the driver
  // got "Couldn't load your driver" until they tapped Retry. Setting it here,
  // inside the async handler that already has the session in hand, means the
  // token is live *before* the re-render that mounts any consumer, so there is
  // no effect ordering left to lose.
  const applySession = useCallback((next: Session | null) => {
    setTokenProvider(() => next?.token ?? null)
    setSession(next)
  }, [])

  // Cold-start restore (SESSION-02) — check for existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const raw = await storage.getItem(SESSION_KEY)
        if (raw) {
          const stored = JSON.parse(raw) as Session
          applySession(stored)
        }
      } catch (error) {
        logger.error('Error restoring session', error)
      } finally {
        setIsLoading(false)
      }
    }
    checkSession()
  }, [applySession]) // applySession is stable — this still runs exactly once

  // AppState expiry detection (SESSION-04) — check for expired session on foreground resume
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      // session.expiresAt is JWT exp in seconds; Date.now() is milliseconds — convert before comparing
      if (nextState === 'active' && session !== null && session.expiresAt * 1000 < Date.now()) {
        logout()
      }
    })
    return () => subscription.remove()
  }, [session]) // session in dep array — avoids stale closure

  const login = async (email: string, password: string, tenantId: string): Promise<void> => {
    try {
      const newSession = await authService.authenticate(email, password, tenantId)
      await storage.setItem(SESSION_KEY, JSON.stringify(newSession))
      applySession(newSession)
      logger.logAuth('login', email)
    } catch (error) {
      logger.error('Login failed', error)
      throw error
    }
  }

  const loginWithSso = async (tenantId: string, providerId: string): Promise<void> => {
    try {
      const newSession = await authService.authenticateWithSso(tenantId, providerId)
      await storage.setItem(SESSION_KEY, JSON.stringify(newSession))
      applySession(newSession)
      logger.logAuth('login', newSession.email)
    } catch (error) {
      logger.error('SSO login failed', error)
      throw error
    }
  }

  const logout = async (): Promise<void> => {
    try {
      const email = session?.email ?? ''
      // Deactivate this device's push token BEFORE the session is cleared, so the
      // authenticated DELETE still carries a valid bearer. Best-effort.
      await unregisterForPush(email)
      await storage.deleteItem(SESSION_KEY)
      applySession(null)
      logger.logAuth('logout', email)
    } catch (error) {
      logger.error('Error logging out', error)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        isAuthenticated,
        isLoading,
        login,
        loginWithSso,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
