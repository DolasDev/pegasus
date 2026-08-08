// Unit tests for the push-notification registration service.
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { getApiClient } from '../api/client'
import { storage } from '../utils/storage'
import {
  registerForPush,
  unregisterForPush,
  setupNotificationTapHandler,
} from './pushNotifications'

jest.mock('../api/client', () => ({ getApiClient: jest.fn() }))
jest.mock('../utils/storage', () => ({
  storage: { getItem: jest.fn(), setItem: jest.fn(), deleteItem: jest.fn() },
}))

/** Push tokens are cached per ACCOUNT, so every call needs one. */
const ACCOUNT = 'driver@example.com'
const KEY = `pegasus_push_token:${ACCOUNT}`

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

  it('no-ops when permission is denied', async () => {
    ;(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' })
    ;(Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' })
    await registerForPush(ACCOUNT)
    expect(mockFetch).not.toHaveBeenCalled()
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
    expect(body).toEqual({ platform: expect.any(String), expoPushToken: 'ExponentPushToken[abc]' })
    expect(mockedStorage.setItem).toHaveBeenCalledWith(KEY, 'ExponentPushToken[abc]')
  })

  it('skips the network call when the token is unchanged', async () => {
    mockedStorage.getItem.mockResolvedValue('ExponentPushToken[abc]')
    await registerForPush(ACCOUNT)
    expect(mockFetch).not.toHaveBeenCalled()
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
      k === 'pegasus_push_token:previous@example.com' ? 'ExponentPushToken[abc]' : null,
    )
    mockFetch.mockResolvedValue({ id: 'dt-2' })

    await registerForPush(ACCOUNT)

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/device-tokens',
      expect.objectContaining({ method: 'POST' }),
    )
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
    ;(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' })
    ;(Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' })

    const state = await registerForPush(ACCOUNT)

    expect(state.status).toBe('skipped')
    expect((state as { reason: string }).reason).toContain('denied')
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
    expect(mockedStorage.deleteItem).toHaveBeenCalledWith(KEY)
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

    expect(mockedStorage.deleteItem).toHaveBeenCalledWith(KEY)
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

  it('ignores taps with an unknown type', () => {
    const navigate = jest.fn()
    setupNotificationTapHandler(navigate)
    lastListener()(responseWith({ type: 'something.else' }))
    expect(navigate).not.toHaveBeenCalled()
  })
})
