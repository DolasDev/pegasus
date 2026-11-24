import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../theme/colors'
import {
  openPermissionSettings,
  requestPermission,
  settingsSteps,
  type PermissionKind,
  type PermissionState,
} from '../services/permissions'
import { enableNotifications } from '../services/pushNotifications'

/**
 * The one "fix it" action for a permission, chosen by what the OS still
 * allows: prompt while it can, otherwise open the app's Settings page.
 * Returns the new state (unchanged when we sent the driver to Settings —
 * usePermission re-reads it when they come back).
 */
export async function fixPermission(
  kind: PermissionKind,
  state: PermissionState,
  accountKey: string,
): Promise<PermissionState> {
  if (state === 'askable') {
    return kind === 'notifications' ? enableNotifications(accountKey) : requestPermission(kind)
  }
  if (state === 'blocked' || state === 'channelOff') await openPermissionSettings()
  return state
}

/** Button label for the fix — "Open Settings" when that's the only way. */
export function fixLabel(state: PermissionState, askLabel = 'Turn on'): string {
  return state === 'askable' ? askLabel : 'Open Settings'
}

interface Props {
  kind: PermissionKind
  state: PermissionState
  title: string
  body: string
  /** Label for the button while the OS can still prompt. */
  askLabel?: string
  onFix: () => void
  /** Optional secondary action ("Not now", "Choose file instead"). */
  secondary?: { label: string; onPress: () => void }
}

/**
 * Explanation + the right button for a permission's state. When the OS can no
 * longer prompt it also prints where the switch lives on THIS platform, since
 * iOS and Android bury it in different places.
 */
export function PermissionPrompt({ kind, state, title, body, askLabel, onFix, secondary }: Props) {
  const settingsOnly = state === 'blocked' || state === 'channelOff'
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {settingsOnly ? <Text style={styles.steps}>{settingsSteps(kind)}</Text> : null}
      <TouchableOpacity
        style={styles.primary}
        onPress={onFix}
        accessibilityRole="button"
        activeOpacity={0.8}
      >
        <Text style={styles.primaryText}>{fixLabel(state, askLabel)}</Text>
      </TouchableOpacity>
      {secondary ? (
        <TouchableOpacity
          style={styles.secondary}
          onPress={secondary.onPress}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>{secondary.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg },
  title: {
    fontSize: fontSize.xlarge,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  body: { fontSize: fontSize.large, color: colors.textSecondary, marginBottom: spacing.md },
  steps: {
    fontSize: fontSize.medium,
    color: colors.textPrimary,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  primary: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.medium,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  primaryText: { color: colors.textLight, fontSize: fontSize.large, fontWeight: '700' },
  secondary: {
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  secondaryText: { color: colors.textSecondary, fontSize: fontSize.large, fontWeight: '600' },
})
