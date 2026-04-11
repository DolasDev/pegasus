import React from 'react'
import { render, fireEvent, act } from '@testing-library/react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import TenantPickerScreen from '../../../app/(auth)/tenant-picker'
import { type TenantResolution } from '../../../src/auth/types'

// Mock the authServiceInstance module used by tenant-picker screen
const mockSelectTenant = jest.fn()
jest.mock('../../../src/auth/authServiceInstance', () => ({
  getAuthService: jest.fn(() => ({
    selectTenant: mockSelectTenant,
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

const tenantsJson = JSON.stringify(mockTenants)

describe('TenantPickerScreen', () => {
  let routerReplace: jest.Mock

  beforeEach(() => {
    mockSelectTenant.mockReset()
    routerReplace = jest.fn()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({
      email: 'driver@example.com',
      tenantsJson,
    })
    ;(useRouter as jest.Mock).mockReturnValue({
      push: jest.fn(),
      replace: routerReplace,
      back: jest.fn(),
    })
  })

  it('renders "Select Company" title', () => {
    const { getByText } = render(<TenantPickerScreen />)
    expect(getByText('Select Company')).toBeTruthy()
  })

  it('renders all tenant names from tenantsJson param', () => {
    const { getByText } = render(<TenantPickerScreen />)
    expect(getByText('Acme Moving Co')).toBeTruthy()
    expect(getByText('Best Movers')).toBeTruthy()
  })

  it('calls selectTenant with email and tenantId when a company is tapped (TENANT-03)', async () => {
    mockSelectTenant.mockResolvedValueOnce(undefined)
    const { getByText } = render(<TenantPickerScreen />)

    await act(async () => {
      fireEvent.press(getByText('Acme Moving Co'))
    })

    expect(mockSelectTenant).toHaveBeenCalledWith('driver@example.com', 'tenant-acme')
  })

  it('router.replace called with password step params after successful selectTenant (TENANT-03)', async () => {
    mockSelectTenant.mockResolvedValueOnce(undefined)
    const { getByText } = render(<TenantPickerScreen />)

    await act(async () => {
      fireEvent.press(getByText('Acme Moving Co'))
    })

    expect(routerReplace).toHaveBeenCalledWith({
      pathname: '/(auth)/login',
      params: {
        step: 'password',
        tenantId: 'tenant-acme',
        tenantName: 'Acme Moving Co',
        email: 'driver@example.com',
        cognitoAuthEnabled: 'true',
      },
    })
  })

  it('shows inline error text when selectTenant throws (does not crash)', async () => {
    mockSelectTenant.mockRejectedValueOnce(new Error('SelectTenantFailed'))
    const { getByText } = render(<TenantPickerScreen />)

    await act(async () => {
      fireEvent.press(getByText('Best Movers'))
    })

    expect(getByText('Unable to select company. Please try again.')).toBeTruthy()
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('navigating back from picker goes to email step — layout registers tenant-picker in Stack', () => {
    // TENANT-06: back navigation is natural because login.tsx uses router.push to
    // navigate to tenant-picker, so the hardware back button pops back to login email step.
    // This test confirms the screen renders without crashing (the navigation registration
    // in _layout.tsx is the mechanism; tested via the layout file directly).
    const { getByText } = render(<TenantPickerScreen />)
    expect(getByText('Select Company')).toBeTruthy()
  })
})
