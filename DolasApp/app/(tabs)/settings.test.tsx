import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import SettingsScreen from './settings';

const mockLogout = jest.fn();

jest.mock('../../src/context/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    driverName: 'John Driver',
    driverEmail: 'john@example.com',
    logout: mockLogout,
  })),
}));

describe('SettingsScreen', () => {
  beforeEach(() => {
    mockLogout.mockReset();
  });

  it('renders "DRIVER PROFILE" section title', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('DRIVER PROFILE')).toBeTruthy();
  });

  it('displays driver name from context', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('John Driver')).toBeTruthy();
  });

  it('displays driver email from context', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('john@example.com')).toBeTruthy();
  });

  it('renders "APP INFORMATION" section with version from expo-constants', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('APP INFORMATION')).toBeTruthy();
    // expo-constants is mocked with version: '1.0.0'
    expect(getByText('1.0.0')).toBeTruthy();
  });

  it('renders "LOG OUT" button', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('LOG OUT')).toBeTruthy();
  });

  it('pressing "LOG OUT" calls Alert.alert with "Log Out" dialog', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByText } = render(<SettingsScreen />);

    await act(async () => {
      fireEvent.press(getByText('LOG OUT'));
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Log Out',
      'Are you sure you want to log out?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel' }),
        expect.objectContaining({ text: 'Log Out' }),
      ])
    );
  });

  it('pressing "DELETE ACCOUNT" calls Alert.alert with demo restriction message', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByText } = render(<SettingsScreen />);

    await act(async () => {
      fireEvent.press(getByText('DELETE ACCOUNT'));
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete Account',
      expect.stringContaining('not available in this demo'),
      expect.any(Array)
    );
  });

  it('renders "Privacy Policy" link', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Privacy Policy')).toBeTruthy();
  });

  it('renders "Terms of Service" link', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Terms of Service')).toBeTruthy();
  });
});
