import React, { createContext, useContext, useState, useEffect } from 'react'
import * as SecureStore from 'expo-secure-store'
import type { Session } from '../auth/types'
import { logger } from '../utils/logger'

const SESSION_KEY = 'pegasus_session'

interface AuthContextType {
  session: Session | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string, tenantId: string) => Promise<boolean>
  logout: () => Promise<void>
}

type AuthProviderProps = {
  authService: {
    authenticate(email: string, password: string, tenantId: string): Promise<Session>
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

  const login = async (email: string, password: string, tenantId: string): Promise<boolean> => {
    try {
      const newSession = await authService.authenticate(email, password, tenantId)
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(newSession))
      setSession(newSession)
      logger.logAuth('login', email)
      return true
    } catch (error) {
      logger.error('Login failed', error)
      return false
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
