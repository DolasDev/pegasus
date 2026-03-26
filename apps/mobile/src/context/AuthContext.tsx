import React, { createContext, useContext, useState, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { MOCK_DRIVER } from '../services/mockData'
import { logger } from '../utils/logger'

interface AuthContextType {
  isAuthenticated: boolean
  isLoading: boolean
  driverName: string
  driverEmail: string
  login: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const STORAGE_KEY = '@moving_app_session'

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [driverName, setDriverName] = useState('')
  const [driverEmail, setDriverEmail] = useState('')

  useEffect(() => {
    checkSession()
  }, [])

  const checkSession = async () => {
    try {
      const session = await AsyncStorage.getItem(STORAGE_KEY)
      if (session) {
        const { email, name } = JSON.parse(session)
        setDriverEmail(email)
        setDriverName(name)
        setIsAuthenticated(true)
      }
    } catch (error) {
      console.error('Error checking session:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const login = async (email: string, password: string): Promise<boolean> => {
    // Mock authentication - accept any credentials
    // In production, this would call a real API
    if (email && password.length >= 4) {
      const session = {
        email: email,
        name: MOCK_DRIVER.name,
        timestamp: new Date().toISOString(),
      }

      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session))
        setDriverEmail(email)
        setDriverName(MOCK_DRIVER.name)
        setIsAuthenticated(true)
        logger.logAuth('login', email)
        return true
      } catch (error) {
        logger.error('Error saving session', error)
        return false
      }
    }
    return false
  }

  const logout = async () => {
    try {
      const email = driverEmail
      await AsyncStorage.removeItem(STORAGE_KEY)
      setIsAuthenticated(false)
      setDriverEmail('')
      setDriverName('')
      logger.logAuth('logout', email)
    } catch (error) {
      logger.error('Error logging out', error)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        driverName,
        driverEmail,
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
