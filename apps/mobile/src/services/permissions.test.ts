// Unit tests for the shared permission model.
import { Linking, Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as ImagePicker from 'expo-image-picker'
import * as Contacts from 'expo-contacts'
import {
  toPermissionState,
  getPermission,
  requestPermission,
  openPermissionSettings,
  settingsSteps,
  needsFix,
} from './permissions'

let mockIsDevice = true
jest.mock('expo-device', () => ({
  get isDevice() {
    return mockIsDevice
  },
}))

const setOS = (os: typeof Platform.OS) => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os })
}

beforeEach(() => {
  jest.clearAllMocks()
  setOS('ios')
  mockIsDevice = true
})

afterAll(() => setOS('ios'))

describe('toPermissionState', () => {
  it('maps a grant to granted', () => {
    expect(toPermissionState({ status: 'granted', granted: true, canAskAgain: true })).toBe(
      'granted',
    )
  })

  it('treats status "granted" as granted when `granted` is absent', () => {
    expect(toPermissionState({ status: 'granted' })).toBe('granted')
  })

  it('is askable while the OS will still show the prompt', () => {
    // A fresh Android 13+ install may report `denied` before any prompt; only
    // canAskAgain decides.
    expect(toPermissionState({ status: 'denied', granted: false, canAskAgain: true })).toBe(
      'askable',
    )
    expect(toPermissionState({ status: 'undetermined', granted: false, canAskAgain: true })).toBe(
      'askable',
    )
  })

  it('is blocked once the OS will no longer prompt (Settings only)', () => {
    expect(toPermissionState({ status: 'denied', granted: false, canAskAgain: false })).toBe(
      'blocked',
    )
  })

  it('reports limited contacts access as limited', () => {
    expect(
      toPermissionState({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        accessPrivileges: 'limited',
      }),
    ).toBe('limited')
  })

  it('treats Android 13+ app-level notifications OFF as blocked, not granted', () => {
    // The runtime permission is still held (granted: true), but the app's
    // notifications are switched off in App info. No dialog can fix it.
    expect(toPermissionState({ status: 'denied', granted: true, canAskAgain: true })).toBe(
      'blocked',
    )
  })

  it('reports a granted app whose channel is switched off as channelOff', () => {
    expect(toPermissionState({ status: 'granted', granted: true }, { channelOff: true })).toBe(
      'channelOff',
    )
  })
})

describe('needsFix', () => {
  it('is true only for states the driver can act on', () => {
    expect(needsFix('askable')).toBe(true)
    expect(needsFix('blocked')).toBe(true)
    expect(needsFix('channelOff')).toBe(true)
    expect(needsFix('granted')).toBe(false)
    expect(needsFix('limited')).toBe(false)
    expect(needsFix('notApplicable')).toBe(false)
  })
})

describe('getPermission("notifications")', () => {
  it('is notApplicable on a simulator', async () => {
    mockIsDevice = false
    await expect(getPermission('notifications')).resolves.toBe('notApplicable')
  })

  it('is notApplicable on web', async () => {
    setOS('web')
    await expect(getPermission('notifications')).resolves.toBe('notApplicable')
  })

  it('never prompts', async () => {
    ;(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'denied',
      granted: false,
      canAskAgain: true,
    })
    await expect(getPermission('notifications')).resolves.toBe('askable')
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled()
  })

  it('detects a switched-off Android channel', async () => {
    setOS('android')
    ;(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'granted',
      granted: true,
    })
    ;(Notifications.getNotificationChannelAsync as jest.Mock).mockResolvedValueOnce({
      id: 'default',
      importance: Notifications.AndroidImportance.NONE,
    })
    await expect(getPermission('notifications')).resolves.toBe('channelOff')
  })

  it('does not consult channels on iOS', async () => {
    ;(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'granted',
      granted: true,
    })
    await expect(getPermission('notifications')).resolves.toBe('granted')
    expect(Notifications.getNotificationChannelAsync).not.toHaveBeenCalled()
  })
})

describe('getPermission("camera")', () => {
  it('is notApplicable on Android — the ML Kit scanner needs no camera permission', async () => {
    setOS('android')
    await expect(getPermission('camera')).resolves.toBe('notApplicable')
    expect(ImagePicker.getCameraPermissionsAsync).not.toHaveBeenCalled()
  })

  it('reads iOS camera authorization', async () => {
    ;(ImagePicker.getCameraPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'denied',
      granted: false,
      canAskAgain: false,
    })
    await expect(getPermission('camera')).resolves.toBe('blocked')
  })
})

describe('getPermission("contacts")', () => {
  it('reads contacts access', async () => {
    ;(Contacts.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'granted',
      granted: true,
      canAskAgain: true,
      accessPrivileges: 'limited',
    })
    await expect(getPermission('contacts')).resolves.toBe('limited')
  })
})

describe('requestPermission', () => {
  it('shows the OS prompt only when askable', async () => {
    ;(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'denied',
      granted: false,
      canAskAgain: true,
    })
    ;(Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'granted',
      granted: true,
    })
    await expect(requestPermission('notifications')).resolves.toBe('granted')
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1)
  })

  it('does not prompt when blocked', async () => {
    ;(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'denied',
      granted: false,
      canAskAgain: false,
    })
    await expect(requestPermission('notifications')).resolves.toBe('blocked')
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled()
  })

  it('offers Settings (blocked) when the prompt leaves it still askable', async () => {
    // A denial that Android 13+ would let us ask once more, or a prompt that
    // never appeared. Either way the next tap must not be a dead "Turn on".
    ;(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'undetermined',
      granted: false,
      canAskAgain: true,
    })
    ;(Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'denied',
      granted: false,
      canAskAgain: true,
    })
    await expect(requestPermission('notifications')).resolves.toBe('blocked')
  })

  it('requests the iOS camera', async () => {
    ;(ImagePicker.getCameraPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'undetermined',
      granted: false,
      canAskAgain: true,
    })
    ;(ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'denied',
      granted: false,
      canAskAgain: false,
    })
    await expect(requestPermission('camera')).resolves.toBe('blocked')
  })
})

describe('openPermissionSettings', () => {
  it("opens the app's own Settings page", async () => {
    const spy = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined)
    await openPermissionSettings()
    expect(spy).toHaveBeenCalled()
  })
})

describe('settingsSteps', () => {
  it('gives platform-specific directions', () => {
    setOS('ios')
    expect(settingsSteps('notifications')).toMatch(/Notifications/)
    expect(settingsSteps('camera')).toMatch(/Camera/)
    setOS('android')
    expect(settingsSteps('notifications')).toMatch(/App info/)
  })
})
