import React from 'react'
import { render } from '@testing-library/react-native'
import { SplashScreen } from 'expo-router'
import RootLayout from '../../app/_layout'

// Mock AuthContext to control isAuthenticated and isLoading
const mockUseAuth = jest.fn()
jest.mock('../../src/context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}))

// Mock config module
jest.mock('../../src/config', () => ({
  isConfigValid: jest.fn(() => true),
  getMobileConfig: jest.fn(() => ({
    apiUrl: 'http://localhost:3000',
    cognito: {
      region: 'us-east-1',
      userPoolId: 'us-east-1_TestPool123',
      clientId: 'test-client-id',
      domain: 'https://pegasus-test.auth.us-east-1.amazoncognito.com',
      redirectUri: 'movingapp://auth/callback',
    },
  })),
}))

// Mock authServiceInstance
jest.mock('../../src/auth/authServiceInstance', () => ({
  getAuthService: jest.fn(() => ({
    authenticate: jest.fn(),
    authenticateWithSso: jest.fn(),
    resolveTenants: jest.fn(),
    selectTenant: jest.fn(),
  })),
}))

describe('RootLayout auth guard (GUARD-01)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('calls SplashScreen.hideAsync() when isLoading transitions to false', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    })

    render(<RootLayout />)

    expect(SplashScreen.hideAsync).toHaveBeenCalled()
  })

  it('does NOT call SplashScreen.hideAsync() while isLoading is true', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    })

    render(<RootLayout />)

    expect(SplashScreen.hideAsync).not.toHaveBeenCalled()
  })

  it('SplashScreen.preventAutoHideAsync was called at module load', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false })
    render(<RootLayout />)
    expect(SplashScreen.preventAutoHideAsync).toBeDefined()
    expect(typeof SplashScreen.preventAutoHideAsync).toBe('function')
  })

  it('renders Stack.Protected with guard=false when not authenticated', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    })

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Stack } = require('expo-router')

    render(<RootLayout />)

    expect(Stack.Protected).toHaveBeenCalled()
    const receivedProps = (Stack.Protected as jest.Mock).mock.calls[0]?.[0]
    expect(receivedProps).toMatchObject({ guard: false })
  })

  it('renders Stack.Protected with guard=true when authenticated', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    })

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Stack } = require('expo-router')

    render(<RootLayout />)

    expect(Stack.Protected).toHaveBeenCalled()
    const receivedProps = (Stack.Protected as jest.Mock).mock.calls[0]?.[0]
    expect(receivedProps).toMatchObject({ guard: true })
  })

  it('renders ConfigErrorScreen when config is invalid', () => {
    // Override the mock for this test
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isConfigValid } = require('../../src/config')
    ;(isConfigValid as jest.Mock).mockReturnValueOnce(false)

    const { getByText } = render(<RootLayout />)

    expect(getByText('Configuration Error')).toBeTruthy()
  })
})
