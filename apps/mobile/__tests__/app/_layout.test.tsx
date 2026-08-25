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

  // The iOS back chevron is UIKit's: it is drawn only when the screen is not the
  // first in its UINavigationController. These three screens must therefore stay
  // declared on the ROOT stack — pushed on top of `(drawer)` — rather than each
  // sitting alone inside a nested stack, where it would be at index 0 and render
  // no back button at all. This test fails the moment someone re-nests them.
  describe('pushed detail screens keep a native back button (BACK-01)', () => {
    const PUSHED_SCREENS = ['trip/[id]', 'shipment/[orderNum]', 'settings']

    function screenOptionsFor(name: string) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Stack } = require('expo-router')
      const call = (Stack.Screen as jest.Mock).mock.calls.find((c) => c[0]?.name === name)
      return call?.[0]?.options
    }

    beforeEach(() => {
      mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false })
      render(<RootLayout />)
    })

    it.each(PUSHED_SCREENS)('declares %s on the root stack with a shown header', (name) => {
      const options = screenOptionsFor(name)
      expect(options).toBeDefined()
      // headerShown must be re-enabled per screen — the root stack hides headers.
      expect(options).toMatchObject({ headerShown: true, headerBackTitle: 'Back' })
    })

    it('does not declare the old nested group screens', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Stack } = require('expo-router')
      const declared = (Stack.Screen as jest.Mock).mock.calls.map((c) => c[0]?.name)
      // Not "declared without options" — absent entirely. Re-introducing either
      // group name means the nested single-screen stacks are back.
      expect(declared).not.toContain('trip')
      expect(declared).not.toContain('shipment')
    })

    it('renders every pushed screen inside the authenticated guard', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Stack } = require('expo-router')
      const guarded = (Stack.Protected as jest.Mock).mock.calls.find((c) => c[0]?.guard === true)
      expect(guarded).toBeDefined()

      const names = React.Children.toArray(guarded?.[0]?.children)
        .map((child) =>
          React.isValidElement(child) ? (child.props as { name?: string }).name : undefined,
        )
        .filter(Boolean)

      // Settings in particular was auth-guarded only transitively, by living
      // inside the (drawer) group; unguarded it would be publicly reachable.
      expect(names).toEqual(expect.arrayContaining(PUSHED_SCREENS))
    })
  })
})
