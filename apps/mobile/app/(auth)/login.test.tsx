import React from 'react'
import { Alert } from 'react-native'
import { render, fireEvent, act, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import LoginScreen from './login'
import { type TenantResolution, AuthError } from '../../src/auth/types'

// Mock the module-scope authService exported from _layout
jest.mock('../_layout', () => ({
  authService: {
    resolveTenants: jest.fn(),
    selectTenant: jest.fn(),
  },
}))

import { authService } from '../_layout'

const mockResolveTenants = authService.resolveTenants as jest.Mock
const mockSelectTenant = authService.selectTenant as jest.Mock

const mockLogin = jest.fn()

jest.mock('../../src/context/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    login: mockLogin,
  })),
}))

const mockTenants: TenantResolution[] = [
  { tenantId: 'tenant-acme', tenantName: 'Acme Moving Co', cognitoAuthEnabled: true },
  { tenantId: 'tenant-best', tenantName: 'Best Movers', cognitoAuthEnabled: true },
]

describe('LoginScreen', () => {
  let routerPush: jest.Mock
  let routerReplace: jest.Mock

  beforeEach(() => {
    mockLogin.mockReset()
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

      const { getByText, getByPlaceholderText } = render(<LoginScreen />)

      fireEvent.changeText(getByPlaceholderText('Enter password'), 'pass1')

      // Fire the press then advance fake timers to flush React state updates
      await act(async () => {
        fireEvent.press(getByText('LOG IN'))
        jest.advanceTimersByTime(0)
        // Yield to let the synchronous setIsLoading(true) re-render propagate
        await Promise.resolve()
      })

      await waitFor(() => {
        expect(getByText('LOGGING IN...')).toBeTruthy()
      })

      await act(async () => {
        resolveLogin()
      })
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
      const { getByPlaceholderText, getByText } = render(<LoginScreen />)
      fireEvent.changeText(getByPlaceholderText('Enter password'), 'pass1')
      await act(async () => {
        fireEvent.press(getByText('LOG IN'))
        jest.advanceTimersByTime(0)
        await Promise.resolve()
      })
      await waitFor(() => {
        const input = getByPlaceholderText('Enter password')
        expect(input.props.editable).toBe(false)
      })
      await act(async () => {
        resolveFn()
      })
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
})
