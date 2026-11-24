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
import {
  ANDROID_CHANNEL_ID,
  getPermission,
  requestPermission,
  type PermissionState,
} from './permissions'

const PERMISSION_REASON: Record<PermissionState, string> = {
  granted: 'permission granted',
  limited: 'permission limited',
  askable: 'permission not asked yet',
  blocked: 'permission denied',
  channelOff: 'notification channel switched off',
  notApplicable: 'not supported here',
}

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

/**
 * The cached marker is `token|permission`. Values written before permission
 * reporting are a bare token: they simply miss once and get rewritten.
 */
const cacheMarker = (token: string, permission: PermissionState): string => `${token}|${permission}`

/** The token part of a cached marker (or a pre-reporting bare token). */
const tokenFromMarker = (marker: string): string => marker.split('|')[0] ?? marker

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
  | {
      status: 'skipped'
      reason: string
      /** Set when the skip is a permission problem — branch on this, not `reason`. */
      permission?: PermissionState
      at: string
    }
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
 * If permission is ALREADY granted (it never prompts — see enableNotifications),
 * obtains the Expo push token and registers it with the API. Idempotent and cheap to call repeatedly: a no-op on
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

    // CHECK only — never prompt here. This runs on every login and every
    // foreground resume; prompting from it re-showed Android 13+'s dialog on
    // each resume until two dismissals made the denial permanent, and spent
    // iOS's single prompt with no context. Prompting is `enableNotifications`,
    // called from a user tap (the primer screen, a banner's Fix button).
    // The foreground re-run is still what notices a toggle flipped in Settings.
    //
    // The token is registered WHATEVER the permission, with the permission
    // reported alongside it: minting needs no notification permission (iOS
    // registerForRemoteNotifications, Android FCM), and the server needs the
    // row to show dispatch that this driver has notifications off. The server
    // never pushes to an `askable`/`blocked` device
    // (device-tokens.repository.ts → listActiveTokensForUser).
    const permission = await getPermission('notifications')
    if (permission === 'notApplicable') {
      await recordState({ status: 'skipped', reason: PERMISSION_REASON[permission], at })
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
    // account WITH THIS permission — see registeredTokenKey. Caching the pair
    // is what re-reports a permission the driver changed in Settings.
    const key = registeredTokenKey(accountKey)
    const marker = cacheMarker(expoPushToken, permission)
    const cached = await storage.getItem(key)
    if (cached !== marker) {
      await getApiClient().fetch<{ id: string }>('/api/v1/device-tokens', {
        method: 'POST',
        body: JSON.stringify({ platform, expoPushToken, permission }),
      })
      await storage.setItem(key, marker)
      logger.info('Registered device for push notifications', { platform, permission })
    }

    // `channelOff` counts as registered: the app-level permission is held and
    // the server still delivers; the switched-off channel is a nudge only.
    if (permission === 'granted' || permission === 'limited' || permission === 'channelOff') {
      await recordState({ status: 'registered', account: accountKey, at })
    } else {
      logger.info('Push permission not granted', { permission })
      await recordState({
        status: 'skipped',
        reason: PERMISSION_REASON[permission],
        permission,
        at,
      })
    }
    return lastState
  } catch (error) {
    logger.error('Push registration failed', error)
    await recordState({ status: 'failed', reason: String(error), at })
    return lastState
  }
}

/**
 * User-initiated: show the OS prompt if the OS still can, then register. Call
 * ONLY from a tap — see registerForPush for why background code must not
 * prompt. Returns the permission state so the caller can fall back to
 * "Open Settings" when it is `blocked`/`channelOff`.
 */
export async function enableNotifications(accountKey: string): Promise<PermissionState> {
  let state: PermissionState
  try {
    state = await requestPermission('notifications')
  } catch (error) {
    logger.error('Notification permission request failed', error)
    return 'askable'
  }
  if (state === 'granted' || state === 'limited' || state === 'channelOff') {
    await registerForPush(accountKey)
  }
  return state
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
      body: JSON.stringify({ expoPushToken: tokenFromMarker(cached) }),
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
 * The screen a notification opens, from its `data` payload — the deep-link
 * contract the backend sets (lib/push-triggers, lib/notify): `{ type, ...ids }`.
 * Shared by push taps and Activity feed taps so both open the same screen.
 * Null for an unknown type (nothing to open).
 */
export function notificationRoute(data: Record<string, unknown> | undefined | null): string | null {
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
    // A move chat message — open that move's conversation. Not the shipment
    // screen's Chat tab: that screen loads through the longhaul view, which
    // has no local-only orders, so a local driver's tap would dead-end.
    case 'chat.message': {
      const orderNum = data['orderNum']
      if (typeof orderNum !== 'number' && typeof orderNum !== 'string') return '/(drawer)/messages'
      return `/chat/${orderNum}`
    }
    // A driver is blocked on an order's task — open that order's chat, where
    // operations can reach the driver. An automation's message about an order
    // opens the same chat; one with no order has nothing to open.
    case 'workflow.message':
      if (data['orderNum'] == null) return null
    // falls through
    case 'task.blocked': {
      const orderNum = data['orderNum']
      if (typeof orderNum !== 'number' && typeof orderNum !== 'string') return '/(drawer)/messages'
      return `/chat/${orderNum}`
    }
    default:
      return null
  }
}

/**
 * Wires notification taps to navigation (see notificationRoute). Returns an
 * unsubscribe function.
 *
 * `navigate` is injected (rather than importing the router) so this stays
 * testable and decoupled from expo-router internals.
 */
export function setupNotificationTapHandler(navigate: (path: string) => void): {
  remove: () => void
} {
  const route = notificationRoute

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as Record<string, unknown> | undefined
    const path = route(data)
    if (path) navigate(path)
  })

  return { remove: () => subscription.remove() }
}

/**
 * Calls `onReceive` whenever a push arrives while the app is open — the
 * Activity bell refreshes its count on it. Returns an unsubscribe function.
 */
export function onNotificationReceived(onReceive: () => void): { remove: () => void } {
  const subscription = Notifications.addNotificationReceivedListener(() => onReceive())
  return { remove: () => subscription.remove() }
}
