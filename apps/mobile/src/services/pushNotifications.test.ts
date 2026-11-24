// Unit tests for the push-notification registration service.
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { getApiClient } from '../api/client'
import { storage } from '../utils/storage'
import {
  registerForPush,
  enableNotifications,
  unregisterForPush,
  setupNotificationTapHandler,
  notificationRoute,
} from './pushNotifications'

jest.mock('../api/client', () => ({ getApiClient: jest.fn() }))
jest.mock('../utils/storage', () => ({
  storage: { getItem: jest.fn(), setItem: jest.fn(), deleteItem: jest.fn() },
}))

/** Push tokens are cached per ACCOUNT, so every call needs one. */
const ACCOUNT = 'driver@example.com'
/** Derived, not literal — SecureStore rejects '@' and ':' in keys. */
const KEY_RE = /^pegasus_push_token\.[0-9a-f]+$/

const mockFetch = jest.fn()
const mockedStorage = storage as jest.Mocked<typeof storage>

beforeEach(() => {
  jest.clearAllMocks()
  ;(getApiClient as jest.Mock).mockReturnValue({ fetch: mockFetch })
  // Default: pretend we're on a physical device for the register tests.
  ;(Device as { isDevice: boolean }).isDevice = true
  ;(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' })
  ;(Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
    data: 'ExponentPushToken[abc]',
  })
})

describe('registerForPush', () => {
  it('no-ops on a non-physical device', async () => {
    ;(Device as { isDevice: boolean }).isDevice = false
    await registerForPush(ACCOUNT)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  // The server needs the row to show dispatch that notifications are off; it
  // never pushes to a blocked/askable device.
  it('still registers the token when permission is denied, reporting it', async () => {
    ;(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'denied',
      canAskAgain: false,
    })
    mockedStorage.getItem.mockResolvedValue(null)
    mockFetch.mockResolvedValue({ id: 'dt-1' })

    const state = await registerForPush(ACCOUNT)

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toMatchObject({ permission: 'blocked' })
    expect(state.status).toBe('skipped')
  })

  it('registers the token with the API and caches it', async () => {
    mockedStorage.getItem.mockResolvedValue(null)
    mockFetch.mockResolvedValue({ id: 'dt-1' })

    await registerForPush(ACCOUNT)

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/device-tokens',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({
      platform: expect.any(String),
      expoPushToken: 'ExponentPushToken[abc]',
      permission: 'granted',
    })
    expect(mockedStorage.setItem).toHaveBeenCalledWith(
      expect.stringMatching(KEY_RE),
      'ExponentPushToken[abc]|granted',
    )
  })

  it('skips the network call when the token AND permission are unchanged', async () => {
    mockedStorage.getItem.mockResolvedValue('ExponentPushToken[abc]|granted')
    await registerForPush(ACCOUNT)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('re-reports when only the permission changed (fixed in Settings)', async () => {
    mockedStorage.getItem.mockResolvedValue('ExponentPushToken[abc]|blocked')
    mockFetch.mockResolvedValue({ id: 'dt-1' })
    await registerForPush(ACCOUNT)
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toMatchObject({ permission: 'granted' })
  })

  it('re-reports once over a cache value written before permission reporting', async () => {
    mockedStorage.getItem.mockResolvedValue('ExponentPushToken[abc]')
    mockFetch.mockResolvedValue({ id: 'dt-1' })
    await registerForPush(ACCOUNT)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('never throws when the API call fails', async () => {
    mockedStorage.getItem.mockResolvedValue(null)
    mockFetch.mockRejectedValue(new Error('500'))
    await expect(registerForPush(ACCOUNT)).resolves.toBeDefined()
  })

  it('re-registers when a DIFFERENT account signs in on the same device', async () => {
    // The Expo token identifies the device, not the user — so the previous
    // account's cached token must not suppress registration for a new one.
    mockedStorage.getItem.mockImplementation(async (k: string) =>
      k.startsWith('pegasus_push_token.') ? null : 'ExponentPushToken[abc]',
    )
    mockFetch.mockResolvedValue({ id: 'dt-2' })

    await registerForPush(ACCOUNT)

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/device-tokens',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('only ever passes SecureStore-legal keys (no @ or : from the email)', async () => {
    // SecureStore accepts [A-Za-z0-9._-] and THROWS otherwise. Interpolating an
    // email produced "Invalid key provided to secure store" on a real device,
    // after the token had already been minted — so registration died at the
    // cache read with a message that looked like an FCM problem.
    mockedStorage.getItem.mockResolvedValue(null)
    mockFetch.mockResolvedValue({ id: 'dt-9' })

    await registerForPush('steve@dolas.dev')

    const keys = [
      ...mockedStorage.getItem.mock.calls.map((c) => c[0]),
      ...mockedStorage.setItem.mock.calls.map((c) => c[0]),
    ]
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) expect(k).toMatch(/^[A-Za-z0-9._-]+$/)
  })

  it('reports a token-mint failure without contacting the API', async () => {
    mockedStorage.getItem.mockResolvedValue(null)
    ;(Notifications.getExpoPushTokenAsync as jest.Mock).mockRejectedValue(
      new Error('FirebaseApp is not initialized'),
    )

    const state = await registerForPush(ACCOUNT)

    expect(mockFetch).not.toHaveBeenCalled()
    expect(state.status).toBe('failed')
    expect((state as { reason: string }).reason).toContain('token mint')
  })

  it('reports denied permission as a skip, with the reason', async () => {
    ;(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'denied',
      canAskAgain: false,
    })

    const state = await registerForPush(ACCOUNT)

    expect(state.status).toBe('skipped')
    expect((state as { reason: string }).reason).toContain('denied')
    expect((state as { permission?: string }).permission).toBe('blocked')
  })

  // The regression this guards: registerForPush runs on EVERY foreground
  // resume, and used to call requestPermissionsAsync each time — re-showing
  // Android 13+'s dialog until two dismissals made the denial permanent.
  it('never shows the OS prompt, even when the OS still could', async () => {
    ;(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'denied',
      canAskAgain: true,
    })

    mockedStorage.getItem.mockResolvedValue(null)
    mockFetch.mockResolvedValue({ id: 'dt-1' })

    const state = await registerForPush(ACCOUNT)

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled()
    expect((state as { permission?: string }).permission).toBe('askable')
  })
})

describe('registerForPush — Android channel switched off', () => {
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' })
  })

  it('still registers the token (the switched-off channel is only a nudge)', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' })
    ;(Notifications.getNotificationChannelAsync as jest.Mock).mockResolvedValueOnce({
      id: 'default',
      importance: Notifications.AndroidImportance.NONE,
    })
    mockedStorage.getItem.mockResolvedValue(null)
    mockFetch.mockResolvedValue({ id: 'dt-1' })

    const state = await registerForPush(ACCOUNT)

    expect(state.status).toBe('registered')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/device-tokens',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('enableNotifications', () => {
  it('prompts when askable, then registers on a grant', async () => {
    ;(Notifications.getPermissionsAsync as jest.Mock)
      .mockResolvedValueOnce({ status: 'denied', canAskAgain: true }) // request's pre-check
      .mockResolvedValue({ status: 'granted' }) // registerForPush's check
    ;(Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'granted',
    })
    mockedStorage.getItem.mockResolvedValue(null)
    mockFetch.mockResolvedValue({ id: 'dt-1' })

    await expect(enableNotifications(ACCOUNT)).resolves.toBe('granted')

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/device-tokens',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('returns blocked without prompting', async () => {
    ;(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'denied',
      canAskAgain: false,
    })

    await expect(enableNotifications(ACCOUNT)).resolves.toBe('blocked')

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled()
  })
})

describe('unregisterForPush', () => {
  it('deletes the cached token via the API and clears the cache', async () => {
    mockedStorage.getItem.mockResolvedValue('ExponentPushToken[abc]')
    mockFetch.mockResolvedValue({ deactivated: true })

    await unregisterForPush(ACCOUNT)

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/device-tokens',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(mockedStorage.deleteItem).toHaveBeenCalledWith(expect.stringMatching(KEY_RE))
  })

  it('sends only the token part of a `token|permission` cache marker', async () => {
    mockedStorage.getItem.mockResolvedValue('ExponentPushToken[abc]|blocked')
    mockFetch.mockResolvedValue({ deactivated: true })

    await unregisterForPush(ACCOUNT)

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ expoPushToken: 'ExponentPushToken[abc]' })
  })

  it('no-ops when there is no cached token', async () => {
    mockedStorage.getItem.mockResolvedValue(null)
    await unregisterForPush(ACCOUNT)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('clears the cached token even when the API DELETE fails', async () => {
    // Clearing only on success poisoned the cache: the marker survived, so
    // every later login short-circuited and the device could never re-register.
    mockedStorage.getItem.mockResolvedValue('ExponentPushToken[abc]')
    mockFetch.mockRejectedValue(new Error('network down'))

    await expect(unregisterForPush(ACCOUNT)).resolves.toBeUndefined()

    expect(mockedStorage.deleteItem).toHaveBeenCalledWith(expect.stringMatching(KEY_RE))
  })
})

describe('setupNotificationTapHandler', () => {
  function lastListener() {
    const calls = (Notifications.addNotificationResponseReceivedListener as jest.Mock).mock.calls
    return calls[calls.length - 1][0] as (response: unknown) => void
  }
  const responseWith = (data: Record<string, unknown>) => ({
    notification: { request: { content: { data } } },
  })

  it('deep-links a trip.assigned tap to that trip', () => {
    const navigate = jest.fn()
    setupNotificationTapHandler(navigate)
    lastListener()(responseWith({ type: 'trip.assigned', tripId: 4242 }))
    expect(navigate).toHaveBeenCalledWith('/trip/4242')
  })

  it('falls back to My Trips for a trip.assigned tap with no tripId', () => {
    const navigate = jest.fn()
    setupNotificationTapHandler(navigate)
    lastListener()(responseWith({ type: 'trip.assigned' }))
    expect(navigate).toHaveBeenCalledWith('/(drawer)/trips')
  })

  it('routes a move.assigned tap to the My Trips screen', () => {
    const navigate = jest.fn()
    setupNotificationTapHandler(navigate)
    lastListener()(responseWith({ type: 'move.assigned', moveId: 'm-1' }))
    expect(navigate).toHaveBeenCalledWith('/(drawer)/trips')
  })

  it('routes a move.assigned tap to My Trips even without a moveId', () => {
    const navigate = jest.fn()
    setupNotificationTapHandler(navigate)
    lastListener()(responseWith({ type: 'move.assigned' }))
    expect(navigate).toHaveBeenCalledWith('/(drawer)/trips')
  })

  it("opens a chat.message tap on that move's conversation", () => {
    const navigate = jest.fn()
    setupNotificationTapHandler(navigate)
    lastListener()(responseWith({ type: 'chat.message', orderNum: 4242, messageId: 'm-1' }))
    expect(navigate).toHaveBeenCalledWith('/chat/4242')
  })

  it('falls back to Messages for a chat.message tap with no orderNum', () => {
    const navigate = jest.fn()
    setupNotificationTapHandler(navigate)
    lastListener()(responseWith({ type: 'chat.message' }))
    expect(navigate).toHaveBeenCalledWith('/(drawer)/messages')
  })

  it('ignores taps with an unknown type', () => {
    const navigate = jest.fn()
    setupNotificationTapHandler(navigate)
    lastListener()(responseWith({ type: 'something.else' }))
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('notificationRoute', () => {
  it('is the same route for a push tap and an Activity row', () => {
    expect(notificationRoute({ type: 'trip.assigned', tripId: 9 })).toBe('/trip/9')
    expect(notificationRoute({ type: 'chat.message', orderNum: '4242' })).toBe('/chat/4242')
    expect(notificationRoute({ type: 'task.blocked', orderNum: '500' })).toBe('/chat/500')
    expect(notificationRoute({ type: 'workflow.message', orderNum: '42' })).toBe('/chat/42')
    expect(notificationRoute({ type: 'workflow.message' })).toBeNull()
    expect(notificationRoute({ type: 'staff.message' })).toBeNull()
    expect(notificationRoute(null)).toBeNull()
  })
})
