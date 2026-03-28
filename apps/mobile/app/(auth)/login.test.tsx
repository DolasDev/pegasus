import React from 'react'
import { render, fireEvent, act } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import LoginScreen from './login'
import { TenantResolution } from '../../src/auth/types'

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
      mockLogin.mockResolvedValueOnce(true)

      const { getByText, getByPlaceholderText } = render(<LoginScreen />)

      fireEvent.changeText(getByPlaceholderText('Enter password'), 'pass1')

      await act(async () => {
        fireEvent.press(getByText('LOG IN'))
      })

      expect(mockLogin).toHaveBeenCalledWith('driver@example.com', 'pass1', 'tenant-acme')
    })

    it('shows "LOGGING IN..." while login is in progress', async () => {
      let resolveLogin!: (v: boolean) => void
      mockLogin.mockReturnValueOnce(
        new Promise<boolean>((res) => {
          resolveLogin = res
        }),
      )

      const { getByText, getByPlaceholderText } = render(<LoginScreen />)

      fireEvent.changeText(getByPlaceholderText('Enter password'), 'pass1')

      act(() => {
        fireEvent.press(getByText('LOG IN'))
      })

      expect(getByText('LOGGING IN...')).toBeTruthy()

      await act(async () => {
        resolveLogin(true)
      })
    })
  })
})
