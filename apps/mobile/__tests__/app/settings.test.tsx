import React from 'react'
import { render, fireEvent, act } from '@testing-library/react-native'
import { Alert, Linking } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Contacts from 'expo-contacts'
import SettingsScreen from '../../app/settings'

const mockLogout = jest.fn()

// Simulator by default (as jest.setup); one test flips it to a real device.
let mockIsDevice = false
jest.mock('expo-device', () => ({
  get isDevice() {
    return mockIsDevice
  },
}))

jest.mock('../../src/context/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    session: {
      sub: 'user-123',
      tenantId: 'tenant-abc',
      role: 'driver',
      email: 'john@example.com',
      expiresAt: Date.now() + 3600_000,
    },
    logout: mockLogout,
  })),
}))

describe('SettingsScreen', () => {
  beforeEach(() => {
    mockLogout.mockReset()
  })

  it('renders "DRIVER PROFILE" section title', () => {
    const { getByText } = render(<SettingsScreen />)
    expect(getByText('DRIVER PROFILE')).toBeTruthy()
  })

  it('displays email from session', () => {
    const { getByText } = render(<SettingsScreen />)
    expect(getByText('john@example.com')).toBeTruthy()
  })

  it('displays role from session', () => {
    const { getByText } = render(<SettingsScreen />)
    expect(getByText('driver')).toBeTruthy()
  })

  it('renders "APP INFORMATION" section with version from expo-constants', () => {
    const { getByText } = render(<SettingsScreen />)
    expect(getByText('APP INFORMATION')).toBeTruthy()
    // expo-constants is mocked with version: '1.0.0'
    expect(getByText('1.0.0')).toBeTruthy()
  })

  it('renders "LOG OUT" button', () => {
    const { getByText } = render(<SettingsScreen />)
    expect(getByText('LOG OUT')).toBeTruthy()
  })

  it('pressing "LOG OUT" calls Alert.alert with "Log Out" dialog', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert')
    const { getByText } = render(<SettingsScreen />)

    await act(async () => {
      fireEvent.press(getByText('LOG OUT'))
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

  it('pressing "DELETE ACCOUNT" calls Alert.alert with demo restriction message', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert')
    const { getByText } = render(<SettingsScreen />)

    await act(async () => {
      fireEvent.press(getByText('DELETE ACCOUNT'))
    })

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete Account',
      expect.stringContaining('not available in this demo'),
      expect.any(Array),
    )
  })

  it('renders "Privacy Policy" link', () => {
    const { getByText } = render(<SettingsScreen />)
    expect(getByText('Privacy Policy')).toBeTruthy()
  })

  it('renders "Terms of Service" link', () => {
    const { getByText } = render(<SettingsScreen />)
    expect(getByText('Terms of Service')).toBeTruthy()
  })

  describe('PERMISSIONS', () => {
    // Settings is the always-there fix for every permission the app uses.
    it('lists each permission with its live state', async () => {
      const { findByLabelText, getByText } = render(<SettingsScreen />)
      expect(getByText('PERMISSIONS')).toBeTruthy()
      // jest.setup defaults: contacts + iOS camera granted. Notifications is
      // notApplicable here (expo-device mock = simulator), so it's hidden.
      expect(await findByLabelText('Camera: Allowed')).toBeTruthy()
      expect(await findByLabelText('Contacts: Allowed')).toBeTruthy()
    })

    it('shows Notifications on a physical device, with a prompt while the OS can still ask', async () => {
      mockIsDevice = true
      try {
        ;(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
          status: 'undetermined',
          granted: false,
          canAskAgain: true,
        })
        const { findByLabelText, findByText } = render(<SettingsScreen />)
        expect(await findByLabelText('Notifications: Not allowed yet')).toBeTruthy()
        await act(async () => {
          fireEvent.press(await findByText('Turn on'))
        })
        expect(Notifications.requestPermissionsAsync).toHaveBeenCalled()
      } finally {
        mockIsDevice = false
        ;(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' })
      }
    })

    it('offers Open Settings for a permission the OS will no longer prompt for', async () => {
      ;(Contacts.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'denied',
        granted: false,
        canAskAgain: false,
      })
      const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined)
      const { findByLabelText, findByText } = render(<SettingsScreen />)
      expect(await findByLabelText('Contacts: Off')).toBeTruthy()
      await act(async () => {
        fireEvent.press(await findByText('Open Settings'))
      })
      expect(open).toHaveBeenCalled()
    })
  })
})
