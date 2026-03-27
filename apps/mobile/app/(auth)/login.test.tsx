import React from 'react'
import { render, fireEvent, act } from '@testing-library/react-native'
import { Alert } from 'react-native'
import LoginScreen from './login'

const mockLogin = jest.fn()

jest.mock('../../src/context/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    login: mockLogin,
  })),
}))

describe('LoginScreen', () => {
  beforeEach(() => {
    mockLogin.mockReset()
  })

  it('renders "Moving & Storage" title', () => {
    const { getByText } = render(<LoginScreen />)
    expect(getByText('Moving & Storage')).toBeTruthy()
  })

  it('renders "Driver Portal" subtitle', () => {
    const { getByText } = render(<LoginScreen />)
    expect(getByText('Driver Portal')).toBeTruthy()
  })

  it('renders EMAIL and PASSWORD labels', () => {
    const { getByText } = render(<LoginScreen />)
    expect(getByText('EMAIL')).toBeTruthy()
    expect(getByText('PASSWORD')).toBeTruthy()
  })

  it('renders "LOG IN" button', () => {
    const { getByText } = render(<LoginScreen />)
    expect(getByText('LOG IN')).toBeTruthy()
  })

  it('shows Alert when pressing LOG IN with empty fields', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert')
    const { getByText } = render(<LoginScreen />)

    await act(async () => {
      fireEvent.press(getByText('LOG IN'))
    })

    expect(alertSpy).toHaveBeenCalledWith('Error', 'Please enter email and password')
  })

  it('calls login(email, password, \'\') with valid credentials — TODO Phase 4: tenantId', async () => {
    mockLogin.mockResolvedValueOnce(true)
    const { getByText, getByPlaceholderText } = render(<LoginScreen />)

    fireEvent.changeText(getByPlaceholderText('driver@company.com'), 'driver@example.com')
    fireEvent.changeText(getByPlaceholderText('Enter password'), 'pass1')

    await act(async () => {
      fireEvent.press(getByText('LOG IN'))
    })

    expect(mockLogin).toHaveBeenCalledWith('driver@example.com', 'pass1', '')
  })

  it('shows "LOGGING IN..." while login is in progress', async () => {
    // Never resolves during this test so we can catch intermediate state
    let resolveLogin!: (v: boolean) => void
    mockLogin.mockReturnValueOnce(
      new Promise<boolean>((res) => {
        resolveLogin = res
      }),
    )

    const { getByText, getByPlaceholderText } = render(<LoginScreen />)

    fireEvent.changeText(getByPlaceholderText('driver@company.com'), 'driver@example.com')
    fireEvent.changeText(getByPlaceholderText('Enter password'), 'pass1')

    // Start the press but don't await completion
    act(() => {
      fireEvent.press(getByText('LOG IN'))
    })

    expect(getByText('LOGGING IN...')).toBeTruthy()

    // Resolve to clean up
    await act(async () => {
      resolveLogin(true)
    })
  })

  it('shows Alert with "Login failed" when login returns false', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert')
    mockLogin.mockResolvedValueOnce(false)

    const { getByText, getByPlaceholderText } = render(<LoginScreen />)

    fireEvent.changeText(getByPlaceholderText('driver@company.com'), 'driver@example.com')
    fireEvent.changeText(getByPlaceholderText('Enter password'), 'pass1')

    await act(async () => {
      fireEvent.press(getByText('LOG IN'))
    })

    expect(alertSpy).toHaveBeenCalledWith('Error', 'Login failed. Please try again.')
  })
})
