// ---------------------------------------------------------------------------
// Push-notification registration service.
//
// Owns the device side of the push pipeline: request permission, obtain the
// Expo push token, register it with the API (POST /api/v1/device-tokens), and
// deactivate it on logout (DELETE). The backend stores the token, and the
// push-forward Lambda delivers notifications to it via the Expo push service.
//
// Notes:
//   • Push tokens only work on physical devices (Device.isDevice) and not on
//     web — registration is a no-op elsewhere.
//   • The last-registered token is cached in secure storage so a re-register on
//     every login/foreground resume is skipped when nothing changed.
//   • Notification *content* and tap-action routing live with the caller (see
//     setupNotificationTapHandler); this module is pure plumbing.
// ---------------------------------------------------------------------------

import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { getApiClient } from '../api/client'
import { storage } from '../utils/storage'
import { logger } from '../utils/logger'

/**
 * Secure-store key holding the Expo push token we last successfully registered,
 * scoped to the account it was registered FOR.
 *
 * The scoping is the whole point. An Expo push token identifies the *device*,
 * not the user, so a single unscoped key made "have we registered this token?"
 * indistinguishable from "have we registered it for THIS user?" — switching
 * accounts on one phone short-circuited registration and left the server row
 * pointing at the previous user, who then received the new user's
 * notifications. Keyed per account, a user switch always re-registers, and
 * upsertDeviceToken re-points the row.
 */
const REGISTERED_TOKEN_KEY = 'pegasus_push_token'

/**
 * Hashes the account into a SecureStore-safe slug (FNV-1a, hex).
 *
 * SecureStore accepts only [A-Za-z0-9._-] and THROWS on anything else, so an
 * email address cannot be interpolated into a key — `@` and `:` both blow up
 * with "Invalid key provided to secure store". Hashing sidesteps the whole
 * character-class question for any future key material, and keeps the user's
 * address out of the device keystore. Collisions are irrelevant here: the
 * value is a cache marker, and a miss only costs one redundant re-register.
 */
function accountSlug(accountKey: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < accountKey.length; i++) {
    h ^= accountKey.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16)
}

const registeredTokenKey = (accountKey: string): string =>
  accountKey ? `${REGISTERED_TOKEN_KEY}.${accountSlug(accountKey)}` : REGISTERED_TOKEN_KEY

/** Secure-store key holding the last registration outcome (see PushRegistrationState). */
const REGISTRATION_STATE_KEY = 'pegasus_push_state'

/**
 * Outcome of the last registration attempt. Every failure path in this module
 * is caught so it can't break app startup, which historically meant a device
 * that silently never registered looked identical to one that had — with no
 * signal anywhere off the phone. Recording the outcome makes it inspectable
 * (Settings surfaces it) instead of requiring a log capture.
 */
export type PushRegistrationState =
  | { status: 'unknown' }
  | { status: 'registered'; account: string; at: string }
  | { status: 'skipped'; reason: string; at: string }
  | { status: 'failed'; reason: string; at: string }

let lastState: PushRegistrationState = { status: 'unknown' }

/** The last registration outcome for this app session. */
export function getPushRegistrationState(): PushRegistrationState {
  return lastState
}

/** Re-reads the persisted outcome, so it survives an app relaunch. */
export async function loadPushRegistrationState(): Promise<PushRegistrationState> {
  try {
    const raw = await storage.getItem(REGISTRATION_STATE_KEY)
    if (raw) lastState = JSON.parse(raw) as PushRegistrationState
  } catch {
    // A corrupt/absent record is not worth surfacing — 'unknown' is honest.
  }
  return lastState
}

async function recordState(state: PushRegistrationState): Promise<void> {
  lastState = state
  try {
    await storage.setItem(REGISTRATION_STATE_KEY, JSON.stringify(state))
  } catch {
    // Persistence is best-effort; the in-memory value still serves this session.
  }
}

const ANDROID_CHANNEL_ID = 'default'

type ApiPlatform = 'IOS' | 'ANDROID'

function apiPlatform(): ApiPlatform | null {
  if (Platform.OS === 'ios') return 'IOS'
  if (Platform.OS === 'android') return 'ANDROID'
  return null // web / unsupported — no push
}

/** Resolves the EAS project id needed by getExpoPushTokenAsync. */
function projectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    // Fallback for some runtimes where the value lands on easConfig.
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId
  )
}

/**
 * Foreground presentation + Android channel. Call once at app startup (before
 * any notification can arrive) so foreground notifications are shown and Android
 * has a channel to post to.
 */
export async function initNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  })

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
    })
  }
}

/**
 * Requests permission (if not already granted), obtains the Expo push token, and
 * registers it with the API. Idempotent and cheap to call repeatedly: a no-op on
 * unsupported platforms, when permission is denied, or when the token is
 * unchanged since the last successful registration. Never throws — failures are
 * logged so they can't break app startup.
 */
export async function registerForPush(accountKey: string): Promise<PushRegistrationState> {
  const at = new Date().toISOString()
  try {
    const platform = apiPlatform()
    if (!platform || !Device.isDevice) {
      logger.info('Push registration skipped (unsupported platform or simulator)')
      await recordState({ status: 'skipped', reason: 'not a physical device', at })
      return lastState
    }

    const existing = await Notifications.getPermissionsAsync()
    let status = existing.status
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync()
      status = requested.status
    }
    if (status !== 'granted') {
      logger.info('Push permission not granted', { status })
      await recordState({ status: 'skipped', reason: `permission ${status}`, at })
      return lastState
    }

    const pid = projectId()
    // Isolated so a token-mint failure is reported as its own cause. This is
    // the step that fails when FCM/Play Services isn't ready (common right
    // after an app-data clear), and it used to be indistinguishable from a
    // network error against our own API.
    let expoPushToken: string
    try {
      const res = await Notifications.getExpoPushTokenAsync(pid ? { projectId: pid } : undefined)
      expoPushToken = res.data
    } catch (error) {
      logger.error('Could not obtain an Expo push token', error)
      await recordState({ status: 'failed', reason: `token mint: ${String(error)}`, at })
      return lastState
    }

    // Skip the round-trip only when this token is already registered for THIS
    // account — see registeredTokenKey.
    const key = registeredTokenKey(accountKey)
    const cached = await storage.getItem(key)
    if (cached === expoPushToken) {
      await recordState({ status: 'registered', account: accountKey, at })
      return lastState
    }

    await getApiClient().fetch<{ id: string }>('/api/v1/device-tokens', {
      method: 'POST',
      body: JSON.stringify({ platform, expoPushToken }),
    })
    await storage.setItem(key, expoPushToken)
    logger.info('Registered device for push notifications', { platform })
    await recordState({ status: 'registered', account: accountKey, at })
    return lastState
  } catch (error) {
    logger.error('Push registration failed', error)
    await recordState({ status: 'failed', reason: String(error), at })
    return lastState
  }
}

/**
 * Deactivates the current device token on the server (logout) and clears the
 * local cache. Best-effort and never throws — logout must always proceed.
 */
export async function unregisterForPush(accountKey: string): Promise<void> {
  const key = registeredTokenKey(accountKey)
  let cached: string | null = null
  try {
    cached = await storage.getItem(key)
    if (!cached) return
    await getApiClient().fetch('/api/v1/device-tokens', {
      method: 'DELETE',
      body: JSON.stringify({ expoPushToken: cached }),
    })
    logger.info('Deactivated device push token')
  } catch (error) {
    logger.error('Push deactivation failed', error)
  } finally {
    // ALWAYS drop the local marker, even when the DELETE failed. Clearing it
    // only on success meant one failed deactivation left a token cached that
    // no longer matched any server row, and every later login short-circuited
    // on it — the device could never re-register, and no in-app action fixed
    // it. A stale server row is self-healing (Expo reports DeviceNotRegistered
    // and the forwarder deactivates it); a poisoned local cache was not.
    if (cached) {
      try {
        await storage.deleteItem(key)
      } catch {
        // Nothing further we can do; the next successful register overwrites it.
      }
    }
    await recordState({ status: 'unknown' })
  }
}

/**
 * Wires notification taps to navigation. The `data` payload set by the backend
 * (lib/push-triggers) carries `{ type, ...ids }`; we translate the known types
 * into deep-link routes. Returns an unsubscribe function.
 *
 * `navigate` is injected (rather than importing the router) so this stays
 * testable and decoupled from expo-router internals.
 */
export function setupNotificationTapHandler(navigate: (path: string) => void): {
  remove: () => void
} {
  const route = (data: Record<string, unknown> | undefined): string | null => {
    if (!data) return null
    switch (data['type']) {
      // A longhaul trip assignment — the driver-facing assignment that actually
      // exists. Deep-links straight to the trip.
      case 'trip.assigned': {
        const tripId = data['tripId']
        if (typeof tripId !== 'number' && typeof tripId !== 'string') return '/(drawer)/trips'
        return `/trip/${tripId}`
      }
      // Driver-facing orders now live in My Trips (sourced from longhaul); the
      // legacy per-move order screen was removed. A cloud moveId doesn't map to
      // a longhaul trip id, so route assignment taps to the trips list.
      case 'move.assigned':
        return '/(drawer)/trips'
      default:
        return null
    }
  }

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as Record<string, unknown> | undefined
    const path = route(data)
    if (path) navigate(path)
  })

  return { remove: () => subscription.remove() }
}
