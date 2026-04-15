import React from 'react'
import { render, fireEvent, act } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { UserMenuButton } from '../UserMenuButton'

const mockLogout = jest.fn()
const mockPush = jest.fn()

jest.mock('../../context/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    session: {
      sub: 'user-1',
      tenantId: 'tenant-abc',
      role: 'driver',
      email: 'jane.doe@example.com',
      expiresAt: Date.now() + 3600_000,
    },
    logout: mockLogout,
  })),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

describe('UserMenuButton', () => {
  beforeEach(() => {
    mockLogout.mockReset()
    mockPush.mockReset()
  })

  it('renders initials derived from the user email', () => {
    const { getByText } = render(<UserMenuButton />)
    expect(getByText('JD')).toBeTruthy()
  })

  it('opens a menu with Settings and Logout when pressed', () => {
    const { getByLabelText, getByText } = render(<UserMenuButton />)

    fireEvent.press(getByLabelText('Open user menu'))

    expect(getByText('Settings')).toBeTruthy()
    expect(getByText('Logout')).toBeTruthy()
  })

  it('navigates to settings when Settings is tapped', () => {
    const { getByLabelText, getByText } = render(<UserMenuButton />)

    fireEvent.press(getByLabelText('Open user menu'))
    fireEvent.press(getByText('Settings'))

    expect(mockPush).toHaveBeenCalledWith('/settings')
  })

  it('triggers logout confirmation when Logout is tapped', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert')
    const { getByLabelText, getByText } = render(<UserMenuButton />)

    fireEvent.press(getByLabelText('Open user menu'))

    await act(async () => {
      fireEvent.press(getByText('Logout'))
    })

    expect(alertSpy).toHaveBeenCalledWith(
      'Log Out',
      'Are you sure you want to log out?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel' }),
        expect.objectContaining({ text: 'Log Out' }),
      ]),
    )
  })
})
