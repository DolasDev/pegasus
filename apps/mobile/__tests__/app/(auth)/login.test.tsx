import React from 'react'
import { Alert } from 'react-native'
import { render, fireEvent, act } from '@testing-library/react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import LoginScreen from '../../../app/(auth)/login'
import { type TenantResolution, AuthError } from '../../../src/auth/types'

// Mock the authServiceInstance module used by login and tenant-picker screens
const mockResolveTenants = jest.fn()
const mockSelectTenant = jest.fn()
jest.mock('../../../src/auth/authServiceInstance', () => ({
  getAuthService: jest.fn(() => ({
    resolveTenants: mockResolveTenants,
    selectTenant: mockSelectTenant,
  })),
}))

const mockLogin = jest.fn()
const mockLoginWithSso = jest.fn()

jest.mock('../../../src/context/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    login: mockLogin,
    loginWithSso: mockLoginWithSso,
  })),
}))

const mockTenants: TenantResolution[] = [
  {
    tenantId: 'tenant-acme',
    tenantName: 'Acme Moving Co',
    cognitoAuthEnabled: true,
    providers: [],
  },
  { tenantId: 'tenant-best', tenantName: 'Best Movers', cognitoAuthEnabled: true, providers: [] },
]

describe('LoginScreen', () => {
  let routerPush: jest.Mock
  let routerReplace: jest.Mock

  beforeEach(() => {
    mockLogin.mockReset()
    mockLoginWithSso.mockReset()
    mockResolveTenants.mockReset()
    mockSelectTenant.mockReset()
    routerPush = jest.fn()
    routerReplace = jest.fn()
    // Default: no params (email step entry)
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({})
    ;(useRouter as jest.Mock).mockReturnValue({
      push: routerPush,
      replace: routerReplace,
      back: jest.fn(),
    })
  })

  describe('email step (initial render)', () => {
    it('renders "Moving & Storage" title', () => {
      const { getByText } = render(<LoginScreen />)
      expect(getByText('Moving & Storage')).toBeTruthy()
    })

    it('renders "Driver Portal" subtitle', () => {
      const { getByText } = render(<LoginScreen />)
      expect(getByText('Driver Portal')).toBeTruthy()
    })

    it('renders EMAIL label', () => {
      const { getByText } = render(<LoginScreen />)
      expect(getByText('EMAIL')).toBeTruthy()
    })

    it('renders "FIND MY COMPANY" submit button', () => {
      const { getByText } = render(<LoginScreen />)
      expect(getByText('FIND MY COMPANY')).toBeTruthy()
    })

    it('calls resolveTenants with the entered email on submit (TENANT-01)', async () => {
      mockResolveTenants.mockResolvedValueOnce(mockTenants)
      const { getByText, getByPlaceholderText } = render(<LoginScreen />)

      fireEvent.changeText(getByPlaceholderText('driver@company.com'), 'driver@example.com')

      await act(async () => {
        fireEvent.press(getByText('FIND MY COMPANY'))
      })

      expect(mockResolveTenants).toHaveBeenCalledWith('driver@example.com')
    })

    it('navigates to tenant-picker with email and tenantsJson when multiple tenants match (TENANT-03)', async () => {
      mockResolveTenants.mockResolvedValueOnce(mockTenants)
      const { getByText, getByPlaceholderText } = render(<LoginScreen />)

      fireEvent.changeText(getByPlaceholderText('driver@company.com'), 'driver@example.com')

      await act(async () => {
        fireEvent.press(getByText('FIND MY COMPANY'))
      })

      expect(routerPush).toHaveBeenCalledWith({
        pathname: '/(auth)/tenant-picker',
        params: {
          email: 'driver@example.com',
          tenantsJson: JSON.stringify(mockTenants),
        },
      })
    })

    it('auto-selects single tenant: calls selectTenant and advances to password step (TENANT-02)', async () => {
      const singleTenant: TenantResolution = {
        tenantId: 'tenant-acme',
        tenantName: 'Acme Moving Co',
        cognitoAuthEnabled: true,
        providers: [],
      }
      mockResolveTenants.mockResolvedValueOnce([singleTenant])
      mockSelectTenant.mockResolvedValueOnce(undefined)

      const { getByText, getByPlaceholderText } = render(<LoginScreen />)

      fireEvent.changeText(getByPlaceholderText('driver@company.com'), 'driver@example.com')

      await act(async () => {
        fireEvent.press(getByText('FIND MY COMPANY'))
      })

      expect(mockSelectTenant).toHaveBeenCalledWith('driver@example.com', 'tenant-acme')
      // Password step should now be visible — company name displayed above password input
      expect(getByText('Acme Moving Co')).toBeTruthy()
      expect(getByText('PASSWORD')).toBeTruthy()
    })

    it('shows inline error "Email not registered with Pegasus" when no tenants match (TENANT-04)', async () => {
      mockResolveTenants.mockResolvedValueOnce([])

      const { getByText, getByPlaceholderText } = render(<LoginScreen />)

      fireEvent.changeText(getByPlaceholderText('driver@company.com'), 'driver@example.com')

      await act(async () => {
        fireEvent.press(getByText('FIND MY COMPANY'))
      })

      expect(getByText('Email not registered with Pegasus')).toBeTruthy()
      // Must NOT navigate
      expect(routerPush).not.toHaveBeenCalled()
    })

    it('does not navigate when email field is empty', async () => {
      const { getByText } = render(<LoginScreen />)

      await act(async () => {
        fireEvent.press(getByText('FIND MY COMPANY'))
      })

      expect(mockResolveTenants).not.toHaveBeenCalled()
    })
  })

  describe('password step (via URL params — picker handoff D-08)', () => {
    beforeEach(() => {
      ;(useLocalSearchParams as jest.Mock).mockReturnValue({
        step: 'password',
        tenantId: 'tenant-acme',
        tenantName: 'Acme Moving Co',
        email: 'driver@example.com',
      })
    })

    it('renders in password step when step=password param is present', () => {
      const { getByText } = render(<LoginScreen />)
      expect(getByText('PASSWORD')).toBeTruthy()
    })

    it('displays company name above password input (TENANT-05)', () => {
      const { getByText } = render(<LoginScreen />)
      expect(getByText('Acme Moving Co')).toBeTruthy()
    })

    it('calls login(email, password, tenantId) when LOG IN is pressed', async () => {
      mockLogin.mockResolvedValueOnce(undefined)

      const { getByText, getByPlaceholderText } = render(<LoginScreen />)

      fireEvent.changeText(getByPlaceholderText('Enter password'), 'pass1')

      await act(async () => {
        fireEvent.press(getByText('LOG IN'))
      })

      expect(mockLogin).toHaveBeenCalledWith('driver@example.com', 'pass1', 'tenant-acme')
    })

    it('shows "LOGGING IN..." while login is in progress', async () => {
      let resolveLogin!: () => void
      mockLogin.mockReturnValueOnce(
        new Promise<void>((res) => {
          resolveLogin = res
        }),
      )

      const { getByText, getByPlaceholderText, unmount } = render(<LoginScreen />)

      fireEvent.changeText(getByPlaceholderText('Enter password'), 'pass1')
      fireEvent.press(getByText('LOG IN'))

      // Yield to microtask queue so React flushes the setIsLoading(true) update,
      // without using act() which hangs on the pending login promise
      await new Promise((r) => setTimeout(r, 50))

      expect(getByText('LOGGING IN...')).toBeTruthy()

      // Clean up: resolve the pending promise and unmount
      resolveLogin()
      unmount()
    })

    it('renders SHOW toggle when password step is active (AUTH-04)', () => {
      const { getByText } = render(<LoginScreen />)
      expect(getByText('SHOW')).toBeTruthy()
    })

    it('toggles to HIDE after SHOW is tapped (AUTH-04)', async () => {
      const { getByText } = render(<LoginScreen />)
      await act(async () => {
        fireEvent.press(getByText('SHOW'))
      })
      expect(getByText('HIDE')).toBeTruthy()
    })

    it('shows inline "Please enter your password." when LOG IN pressed with empty password (AUTH-05)', async () => {
      const { getByText } = render(<LoginScreen />)
      await act(async () => {
        fireEvent.press(getByText('LOG IN'))
      })
      expect(getByText('Please enter your password.')).toBeTruthy()
      expect(mockLogin).not.toHaveBeenCalled()
    })

    it('shows inline error for NotAuthorizedException (AUTH-05)', async () => {
      mockLogin.mockRejectedValueOnce(new AuthError('NotAuthorizedException', 'Bad creds'))
      const { getByText, getByPlaceholderText } = render(<LoginScreen />)
      fireEvent.changeText(getByPlaceholderText('Enter password'), 'wrongpass')
      await act(async () => {
        fireEvent.press(getByText('LOG IN'))
      })
      expect(getByText('Incorrect password. Please try again.')).toBeTruthy()
    })

    it('shows inline error for LimitExceededException (AUTH-05)', async () => {
      mockLogin.mockRejectedValueOnce(new AuthError('LimitExceededException', 'Throttled'))
      const { getByText, getByPlaceholderText } = render(<LoginScreen />)
      fireEvent.changeText(getByPlaceholderText('Enter password'), 'pass1')
      await act(async () => {
        fireEvent.press(getByText('LOG IN'))
      })
      expect(getByText('Too many attempts. Please wait and try again.')).toBeTruthy()
    })

    it('shows fallback inline error for unknown error code (AUTH-05)', async () => {
      mockLogin.mockRejectedValueOnce(new Error('NetworkError'))
      const { getByText, getByPlaceholderText } = render(<LoginScreen />)
      fireEvent.changeText(getByPlaceholderText('Enter password'), 'pass1')
      await act(async () => {
        fireEvent.press(getByText('LOG IN'))
      })
      expect(getByText('Unable to connect. Check your internet and try again.')).toBeTruthy()
    })

    it('does not call Alert.alert on login failure (AUTH-05)', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert')
      mockLogin.mockRejectedValueOnce(new Error('SomeError'))
      const { getByText, getByPlaceholderText } = render(<LoginScreen />)
      fireEvent.changeText(getByPlaceholderText('Enter password'), 'pass1')
      await act(async () => {
        fireEvent.press(getByText('LOG IN'))
      })
      expect(alertSpy).not.toHaveBeenCalled()
      alertSpy.mockRestore()
    })

    it('password TextInput is non-editable while loading (AUTH-06)', async () => {
      let resolveFn!: () => void
      mockLogin.mockReturnValueOnce(
        new Promise<void>((res) => {
          resolveFn = res
        }),
      )
      const { getByPlaceholderText, getByText, unmount } = render(<LoginScreen />)
      fireEvent.changeText(getByPlaceholderText('Enter password'), 'pass1')
      fireEvent.press(getByText('LOG IN'))

      // Yield to microtask queue so React flushes the setIsLoading(true) update
      await new Promise((r) => setTimeout(r, 50))

      expect(getByPlaceholderText('Enter password').props.editable).toBe(false)

      // Clean up: resolve the pending promise and unmount
      resolveFn()
      unmount()
    })

    it('clears passwordError when driver re-types in password field (AUTH-05)', async () => {
      const { getByText, getByPlaceholderText, queryByText } = render(<LoginScreen />)
      await act(async () => {
        fireEvent.press(getByText('LOG IN'))
      })
      expect(getByText('Please enter your password.')).toBeTruthy()
      fireEvent.changeText(getByPlaceholderText('Enter password'), 'a')
      expect(queryByText('Please enter your password.')).toBeNull()
    })
  })

  describe('providers step (SSO login)', () => {
    it('shows SSO provider buttons when single tenant has providers', async () => {
      const ssoTenant: TenantResolution = {
        tenantId: 'tenant-acme',
        tenantName: 'Acme Moving Co',
        cognitoAuthEnabled: false,
        providers: [{ id: 'GoogleSSO', name: 'Google', type: 'oidc' }],
      }
      mockResolveTenants.mockResolvedValueOnce([ssoTenant])
      mockSelectTenant.mockResolvedValueOnce(undefined)

      const { getByText, getByPlaceholderText } = render(<LoginScreen />)

      fireEvent.changeText(getByPlaceholderText('driver@company.com'), 'driver@example.com')
      await act(async () => {
        fireEvent.press(getByText('FIND MY COMPANY'))
      })

      expect(getByText('Acme Moving Co')).toBeTruthy()
      expect(getByText('SIGN IN WITH GOOGLE')).toBeTruthy()
    })

    it('shows password fallback when tenant has both SSO and cognitoAuth', async () => {
      const bothTenant: TenantResolution = {
        tenantId: 'tenant-acme',
        tenantName: 'Acme Moving Co',
        cognitoAuthEnabled: true,
        providers: [{ id: 'OktaSSO', name: 'Okta', type: 'oidc' }],
      }
      mockResolveTenants.mockResolvedValueOnce([bothTenant])
      mockSelectTenant.mockResolvedValueOnce(undefined)

      const { getByText, getByPlaceholderText } = render(<LoginScreen />)

      fireEvent.changeText(getByPlaceholderText('driver@company.com'), 'driver@example.com')
      await act(async () => {
        fireEvent.press(getByText('FIND MY COMPANY'))
      })

      expect(getByText('SIGN IN WITH OKTA')).toBeTruthy()
      expect(getByText('SIGN IN WITH PASSWORD')).toBeTruthy()
    })

    it('navigates to password step when "SIGN IN WITH PASSWORD" is tapped', async () => {
      const bothTenant: TenantResolution = {
        tenantId: 'tenant-acme',
        tenantName: 'Acme Moving Co',
        cognitoAuthEnabled: true,
        providers: [{ id: 'OktaSSO', name: 'Okta', type: 'oidc' }],
      }
      mockResolveTenants.mockResolvedValueOnce([bothTenant])
      mockSelectTenant.mockResolvedValueOnce(undefined)

      const { getByText, getByPlaceholderText } = render(<LoginScreen />)

      fireEvent.changeText(getByPlaceholderText('driver@company.com'), 'driver@example.com')
      await act(async () => {
        fireEvent.press(getByText('FIND MY COMPANY'))
      })

      await act(async () => {
        fireEvent.press(getByText('SIGN IN WITH PASSWORD'))
      })

      expect(getByText('PASSWORD')).toBeTruthy()
    })

    it('calls loginWithSso when SSO provider button is tapped', async () => {
      const ssoTenant: TenantResolution = {
        tenantId: 'tenant-acme',
        tenantName: 'Acme Moving Co',
        cognitoAuthEnabled: false,
        providers: [{ id: 'GoogleSSO', name: 'Google', type: 'oidc' }],
      }
      mockResolveTenants.mockResolvedValueOnce([ssoTenant])
      mockSelectTenant.mockResolvedValueOnce(undefined)
      mockLoginWithSso.mockResolvedValueOnce(undefined)

      const { getByText, getByPlaceholderText } = render(<LoginScreen />)

      fireEvent.changeText(getByPlaceholderText('driver@company.com'), 'driver@example.com')
      await act(async () => {
        fireEvent.press(getByText('FIND MY COMPANY'))
      })

      await act(async () => {
        fireEvent.press(getByText('SIGN IN WITH GOOGLE'))
      })

      expect(mockLoginWithSso).toHaveBeenCalledWith('tenant-acme', 'GoogleSSO')
    })

    it('renders providers step when step=providers param is passed (picker handoff)', () => {
      ;(useLocalSearchParams as jest.Mock).mockReturnValue({
        step: 'providers',
        tenantId: 'tenant-acme',
        tenantName: 'Acme Moving Co',
        email: 'driver@example.com',
        providersJson: JSON.stringify([{ id: 'GoogleSSO', name: 'Google', type: 'oidc' }]),
        cognitoAuthEnabled: 'true',
      })

      const { getByText } = render(<LoginScreen />)

      expect(getByText('Acme Moving Co')).toBeTruthy()
      expect(getByText('SIGN IN WITH GOOGLE')).toBeTruthy()
      expect(getByText('SIGN IN WITH PASSWORD')).toBeTruthy()
    })

    it('shows error message when SSO login fails', async () => {
      const ssoTenant: TenantResolution = {
        tenantId: 'tenant-acme',
        tenantName: 'Acme Moving Co',
        cognitoAuthEnabled: false,
        providers: [{ id: 'GoogleSSO', name: 'Google', type: 'oidc' }],
      }
      mockResolveTenants.mockResolvedValueOnce([ssoTenant])
      mockSelectTenant.mockResolvedValueOnce(undefined)
      mockLoginWithSso.mockRejectedValueOnce(
        new AuthError('TokenExchangeFailed', 'Token exchange failed'),
      )

      const { getByText, getByPlaceholderText } = render(<LoginScreen />)

      fireEvent.changeText(getByPlaceholderText('driver@company.com'), 'driver@example.com')
      await act(async () => {
        fireEvent.press(getByText('FIND MY COMPANY'))
      })

      await act(async () => {
        fireEvent.press(getByText('SIGN IN WITH GOOGLE'))
      })

      expect(getByText('Unable to sign in. Please try again.')).toBeTruthy()
    })
  })
})
