// ---------------------------------------------------------------------------
// One model for the OS permissions the app depends on.
//
// Why this exists: each permission behaves differently per platform, and the
// app used to fire OS prompts with no context and no way back.
//
//   • iOS shows a permission prompt exactly ONCE. After "Don't Allow" only the
//     Settings app can turn it on.
//   • Android 13+ shows POST_NOTIFICATIONS until it's denied twice, then never
//     again ("don't ask again"). Before 13 notifications are on by default, but
//     the app or its channel can be switched off.
//   • Camera only matters on iOS: VisionKit's scanner needs it. Android's ML Kit
//     scanner runs inside Play services and needs no app permission.
//   • "Choose file" uses the system document picker on both platforms — no
//     storage permission exists to ask for.
//
// So every surface branches on ONE question: can the OS still prompt
// (`askable`), or must the driver go to Settings (`blocked`)? We never trust
// `undetermined` for that — a fresh Android 13+ install can report `denied`
// before any prompt — only `granted` + `canAskAgain`.
//
// `getPermission` never prompts. `requestPermission` prompts only when the OS
// still can, and is meant to be called from a user tap (a primer screen, a
// banner's Fix button), never from a background retry.
// ---------------------------------------------------------------------------

import { Linking, Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import * as ImagePicker from 'expo-image-picker'
import * as Contacts from 'expo-contacts'

export type PermissionKind = 'notifications' | 'camera' | 'contacts'

export type PermissionState =
  /** Allowed. */
  | 'granted'
  /** Partially allowed (iOS limited contacts) — usable, nothing to nag about. */
  | 'limited'
  /** Not allowed, and the OS will still show its prompt. */
  | 'askable'
  /** Not allowed, and the OS won't prompt again — Settings is the only fix. */
  | 'blocked'
  /** Android: notifications allowed, but our channel is switched off. */
  | 'channelOff'
  /** Not a thing on this platform/device (web, simulator, Android camera). */
  | 'notApplicable'

/** The channel push notifications post to — see initNotifications. */
export const ANDROID_CHANNEL_ID = 'default'

/** The subset of an expo permission response this module reads. */
export interface OsPermissionResponse {
  status: string
  granted?: boolean
  canAskAgain?: boolean
  accessPrivileges?: string
}

/** Pure mapping from an OS response to our state. Exported for tests. */
export function toPermissionState(
  r: OsPermissionResponse,
  opts: { channelOff?: boolean } = {},
): PermissionState {
  // Android 13+ with notifications switched off in App info reports
  // `granted: true` (the runtime permission is still held) but `status:
  // 'denied'` (expo-notifications NotificationPermissionsModule.kt). Re-asking
  // can't fix that and no dialog would appear, so it's Settings-only.
  if (r.granted === true && r.status === 'denied') return 'blocked'
  const granted = r.status === 'granted' || (r.granted === true && r.status == null)
  if (granted) {
    if (opts.channelOff) return 'channelOff'
    return r.accessPrivileges === 'limited' ? 'limited' : 'granted'
  }
  // `canAskAgain` absent ⇒ assume the OS can still prompt; asking costs at most
  // one dialog, while wrongly sending the driver to Settings is a dead end.
  return r.canAskAgain === false ? 'blocked' : 'askable'
}

/** True when the driver has something to fix. */
export function needsFix(state: PermissionState): boolean {
  return state === 'askable' || state === 'blocked' || state === 'channelOff'
}

function isNative(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android'
}

async function androidChannelOff(): Promise<boolean> {
  if (Platform.OS !== 'android') return false
  try {
    const channel = await Notifications.getNotificationChannelAsync(ANDROID_CHANNEL_ID)
    return channel?.importance === Notifications.AndroidImportance.NONE
  } catch {
    return false // Can't tell — don't invent a problem.
  }
}

/** Current state, WITHOUT prompting. */
export async function getPermission(kind: PermissionKind): Promise<PermissionState> {
  if (!isNative()) return 'notApplicable'
  switch (kind) {
    case 'notifications': {
      if (!Device.isDevice) return 'notApplicable'
      const r = await Notifications.getPermissionsAsync()
      return toPermissionState(r, { channelOff: await androidChannelOff() })
    }
    case 'camera':
      if (Platform.OS !== 'ios') return 'notApplicable'
      return toPermissionState(await ImagePicker.getCameraPermissionsAsync())
    case 'contacts':
      return toPermissionState(await Contacts.getPermissionsAsync())
  }
}

/**
 * Shows the OS prompt if — and only if — the OS still can. Call from a user
 * action. Returns the resulting state; a `blocked`/`channelOff` state is
 * returned unchanged (send the driver to Settings).
 */
export async function requestPermission(kind: PermissionKind): Promise<PermissionState> {
  const current = await getPermission(kind)
  if (current !== 'askable') return current
  const after = await promptOs(kind)
  // Still not granted right after asking: the driver said no, or no dialog
  // could appear at all. Either way the next tap must not be a dead "Turn on"
  // button, so offer Settings, which always works. (Android 13+ would allow one
  // more prompt after a first denial; that isn't worth a button that might do
  // nothing.)
  return after === 'askable' ? 'blocked' : after
}

async function promptOs(kind: PermissionKind): Promise<PermissionState> {
  switch (kind) {
    case 'notifications':
      return toPermissionState(await Notifications.requestPermissionsAsync(), {
        channelOff: await androidChannelOff(),
      })
    case 'camera':
      return toPermissionState(await ImagePicker.requestCameraPermissionsAsync())
    case 'contacts':
      return toPermissionState(await Contacts.requestPermissionsAsync())
  }
}

/** Opens the app's own page in the system Settings app (both platforms). */
export async function openPermissionSettings(): Promise<void> {
  try {
    await Linking.openSettings()
  } catch {
    // Nothing more we can do; the on-screen steps still say where to go.
  }
}

const LABEL: Record<PermissionKind, string> = {
  notifications: 'Notifications',
  camera: 'Camera',
  contacts: 'Contacts',
}

/** Where to flip the switch, in the driver's own platform's words. */
export function settingsSteps(kind: PermissionKind): string {
  if (Platform.OS === 'ios') {
    return kind === 'notifications'
      ? 'Settings → Pegasus → Notifications → turn on Allow Notifications.'
      : `Settings → Pegasus → turn on ${LABEL[kind]}.`
  }
  return kind === 'notifications'
    ? 'App info → Notifications → turn on notifications (and the Default category).'
    : `App info → Permissions → ${LABEL[kind]} → Allow.`
}
