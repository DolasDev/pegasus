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

/** Secure-store key holding the Expo push token we last successfully registered. */
const REGISTERED_TOKEN_KEY = 'pegasus_push_token'

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
export async function registerForPush(): Promise<void> {
  try {
    const platform = apiPlatform()
    if (!platform || !Device.isDevice) {
      logger.info('Push registration skipped (unsupported platform or simulator)')
      return
    }

    const existing = await Notifications.getPermissionsAsync()
    let status = existing.status
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync()
      status = requested.status
    }
    if (status !== 'granted') {
      logger.info('Push permission not granted', { status })
      return
    }

    const pid = projectId()
    const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync(
      pid ? { projectId: pid } : undefined,
    )

    // Skip the network round-trip if we already registered this exact token.
    const cached = await storage.getItem(REGISTERED_TOKEN_KEY)
    if (cached === expoPushToken) return

    await getApiClient().fetch<{ id: string }>('/api/v1/device-tokens', {
      method: 'POST',
      body: JSON.stringify({ platform, expoPushToken }),
    })
    await storage.setItem(REGISTERED_TOKEN_KEY, expoPushToken)
    logger.info('Registered device for push notifications', { platform })
  } catch (error) {
    logger.error('Push registration failed', error)
  }
}

/**
 * Deactivates the current device token on the server (logout) and clears the
 * local cache. Best-effort and never throws — logout must always proceed.
 */
export async function unregisterForPush(): Promise<void> {
  try {
    const cached = await storage.getItem(REGISTERED_TOKEN_KEY)
    if (!cached) return
    await getApiClient().fetch('/api/v1/device-tokens', {
      method: 'DELETE',
      body: JSON.stringify({ expoPushToken: cached }),
    })
    await storage.deleteItem(REGISTERED_TOKEN_KEY)
    logger.info('Deactivated device push token')
  } catch (error) {
    logger.error('Push deactivation failed', error)
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
