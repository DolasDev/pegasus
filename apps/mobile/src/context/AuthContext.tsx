import React, { createContext, useContext, useState, useEffect } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import type { Session } from '../auth/types'
import { logger } from '../utils/logger'

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

  // Cold-start restore (SESSION-02) — check for existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const raw = await SecureStore.getItemAsync(SESSION_KEY)
        if (raw) {
          const stored = JSON.parse(raw) as Session
          setSession(stored)
        }
      } catch (error) {
        logger.error('Error restoring session', error)
      } finally {
        setIsLoading(false)
      }
    }
    checkSession()
  }, [])

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
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(newSession))
      setSession(newSession)
      logger.logAuth('login', email)
    } catch (error) {
      logger.error('Login failed', error)
      throw error
    }
  }

  const loginWithSso = async (tenantId: string, providerId: string): Promise<void> => {
    try {
      const newSession = await authService.authenticateWithSso(tenantId, providerId)
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(newSession))
      setSession(newSession)
      logger.logAuth('login', newSession.email)
    } catch (error) {
      logger.error('SSO login failed', error)
      throw error
    }
  }

  const logout = async (): Promise<void> => {
    try {
      const email = session?.email ?? ''
      await SecureStore.deleteItemAsync(SESSION_KEY)
      setSession(null)
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
