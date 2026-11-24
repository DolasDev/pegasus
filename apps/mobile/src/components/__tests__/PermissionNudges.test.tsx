// Banner, primer, and scan pre-flight: the in-app nudges for OS permissions.
import React from 'react'
import { Alert, Linking } from 'react-native'
import { render, fireEvent, waitFor, act } from '@testing-library/react-native'
import * as Notifications from 'expo-notifications'
import * as ImagePicker from 'expo-image-picker'
import { scanPages } from '../../services/documentCapture'
import { PermissionBanner, BANNER_SNOOZE_MS, SNOOZE_KEY } from '../PermissionBanner'
import { PushPrimer, PUSH_PRIMER_KEY } from '../PushPrimer'
import { AddDocumentModal } from '../AddDocumentModal'
import { storage } from '../../utils/storage'

jest.mock('expo-device', () => ({ isDevice: true }))
jest.mock('../../utils/storage', () => ({
  storage: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    deleteItem: jest.fn(() => Promise.resolve()),
  },
}))
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ session: { email: 'driver@example.com' } }),
}))
jest.mock('../../api/client', () => ({
  getApiClient: () => ({ fetch: jest.fn(() => Promise.resolve({ id: 'dt-1' })) }),
}))
jest.mock('../../services/documentCapture', () => ({
  PDF_MIME: 'application/pdf',
  scanPages: jest.fn(() => Promise.resolve([])),
  pickFromDevice: jest.fn(() => Promise.resolve(null)),
  buildPdfFromImages: jest.fn(),
  preparePickedPdf: jest.fn(),
}))
jest.mock('../../services/documentService', () => ({
  DocumentService: { uploadDocument: jest.fn() },
}))

const mockedStorage = storage as jest.Mocked<typeof storage>
const perm = (p: object) => (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue(p)

beforeEach(() => {
  jest.clearAllMocks()
  mockedStorage.getItem.mockResolvedValue(null)
})

describe('PermissionBanner', () => {
  it('renders nothing while notifications are allowed', async () => {
    perm({ status: 'granted', granted: true })
    const { queryByText } = render(<PermissionBanner message="Notifications are off" />)
    await act(async () => {})
    expect(queryByText('Notifications are off')).toBeNull()
  })

  it('offers "Turn on" and prompts while the OS still can', async () => {
    perm({ status: 'denied', granted: false, canAskAgain: true })
    ;(Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'granted',
      granted: true,
    })
    const { findByText } = render(<PermissionBanner message="Notifications are off" />)
    fireEvent.press(await findByText('Turn on'))
    await waitFor(() => expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1))
  })

  it('offers "Open Settings" once the OS will not prompt again', async () => {
    perm({ status: 'denied', granted: false, canAskAgain: false })
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined)
    const { findByText } = render(<PermissionBanner message="Notifications are off" />)
    fireEvent.press(await findByText('Open Settings'))
    await waitFor(() => expect(open).toHaveBeenCalled())
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled()
  })

  it('"Later" hides it and stores a snooze', async () => {
    perm({ status: 'denied', granted: false, canAskAgain: false })
    const { findByText, queryByText } = render(
      <PermissionBanner snoozeable message="Notifications are off" />,
    )
    fireEvent.press(await findByText('Later'))
    expect(queryByText('Notifications are off')).toBeNull()
    const [, until] = mockedStorage.setItem.mock.calls[0]!
    expect(Number(until)).toBeGreaterThan(Date.now() + BANNER_SNOOZE_MS - 60_000)
  })

  it('stays hidden while snoozed', async () => {
    perm({ status: 'denied', granted: false, canAskAgain: false })
    mockedStorage.getItem.mockResolvedValue(String(Date.now() + 60_000))
    const { queryByText } = render(<PermissionBanner snoozeable message="Notifications are off" />)
    await act(async () => {})
    expect(queryByText('Notifications are off')).toBeNull()
  })
})

describe('PushPrimer', () => {
  it('explains before the OS prompt, and prompts only on "Turn on notifications"', async () => {
    perm({ status: 'undetermined', granted: false, canAskAgain: true })
    const { findByText } = render(<PushPrimer enabled accountKey="driver@example.com" />)
    expect(await findByText('Stay in the loop')).toBeTruthy()
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled()

    fireEvent.press(await findByText('Turn on notifications'))
    await waitFor(() => expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1))
    expect(mockedStorage.setItem).toHaveBeenCalledWith(PUSH_PRIMER_KEY, expect.any(String))
  })

  it('"Not now" leaves the OS prompt unspent', async () => {
    perm({ status: 'undetermined', granted: false, canAskAgain: true })
    const { findByText } = render(<PushPrimer enabled accountKey="driver@example.com" />)
    fireEvent.press(await findByText('Not now'))
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled()
    expect(mockedStorage.setItem).toHaveBeenCalledWith(PUSH_PRIMER_KEY, expect.any(String))
    // …and the dashboard banner doesn't immediately re-ask.
    expect(mockedStorage.setItem).toHaveBeenCalledWith(SNOOZE_KEY, expect.any(String))
  })

  it('never shows twice on a device', async () => {
    perm({ status: 'undetermined', granted: false, canAskAgain: true })
    mockedStorage.getItem.mockResolvedValue('2026-11-24T00:00:00Z')
    const { queryByText } = render(<PushPrimer enabled accountKey="driver@example.com" />)
    await act(async () => {})
    expect(queryByText('Stay in the loop')).toBeNull()
  })

  it('does not show when the OS can no longer prompt (the banner handles that)', async () => {
    perm({ status: 'denied', granted: false, canAskAgain: false })
    const { queryByText } = render(<PushPrimer enabled accountKey="driver@example.com" />)
    await act(async () => {})
    expect(queryByText('Stay in the loop')).toBeNull()
  })

  it('does not show before login', async () => {
    perm({ status: 'undetermined', granted: false, canAskAgain: true })
    const { queryByText } = render(<PushPrimer enabled={false} accountKey="" />)
    await act(async () => {})
    expect(queryByText('Stay in the loop')).toBeNull()
  })
})

describe('AddDocumentModal — iOS camera pre-flight', () => {
  const renderModal = () =>
    render(<AddDocumentModal visible orderNum={42} onClose={jest.fn()} onUploaded={jest.fn()} />)

  it('scans straight away when the camera is allowed', async () => {
    const { getByText } = renderModal()
    fireEvent.press(getByText('Scan'))
    await waitFor(() => expect(scanPages).toHaveBeenCalled())
  })

  it('soft-asks before the one-shot iOS camera prompt', async () => {
    ;(ImagePicker.getCameraPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'undetermined',
      granted: false,
      canAskAgain: true,
    })
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    const { getByText } = renderModal()
    fireEvent.press(getByText('Scan'))
    await waitFor(() => expect(alert).toHaveBeenCalled())
    expect(alert.mock.calls[0]![0]).toBe('Allow camera access')
    expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled()
    expect(scanPages).not.toHaveBeenCalled()

    // "Continue" → OS prompt → scan.
    ;(ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'granted',
      granted: true,
    })
    const cont = alert.mock.calls[0]![2]!.find((b) => b.text === 'Continue')!
    await act(async () => cont.onPress!())
    await waitFor(() => expect(scanPages).toHaveBeenCalled())
  })

  it('offers Settings or a file instead of a dead scanner when the camera is blocked', async () => {
    ;(ImagePicker.getCameraPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'denied',
      granted: false,
      canAskAgain: false,
    })
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined)
    const { getByText } = renderModal()
    fireEvent.press(getByText('Scan'))
    await waitFor(() => expect(alert).toHaveBeenCalled())
    expect(alert.mock.calls[0]![0]).toBe('Camera access is off')
    const labels = alert.mock.calls[0]![2]!.map((b) => b.text)
    expect(labels).toEqual(['Cancel', 'Choose file', 'Open Settings'])
    expect(scanPages).not.toHaveBeenCalled()

    alert.mock.calls[0]![2]!.find((b) => b.text === 'Open Settings')!.onPress!()
    await waitFor(() => expect(open).toHaveBeenCalled())
  })
})
