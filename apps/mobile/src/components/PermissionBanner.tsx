import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { colors, fontSize, spacing, borderRadius } from '../theme/colors'
import { usePermission } from '../hooks/usePermission'
import { useAuth } from '../context/AuthContext'
import { needsFix } from '../services/permissions'
import { storage } from '../utils/storage'
import { fixLabel, fixPermission } from './PermissionPrompt'

/** How long "Later" hides the dashboard banner. A constant on purpose — tune it. */
export const BANNER_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000
export const SNOOZE_KEY = 'pegasus_push_banner_snoozed_until'

interface Props {
  /** The line shown while notifications are off. */
  message: string
  /** Dashboard: offer "Later". Notification settings: always shown. */
  snoozeable?: boolean
}

/**
 * "Notifications are off" with a one-tap fix. Re-reads the OS state on every
 * foreground, so it vanishes as soon as the driver flips the switch. Renders
 * nothing when push is fine or not applicable (web, simulator).
 */
export function PermissionBanner({ message, snoozeable = false }: Props) {
  const { session } = useAuth()
  const { state, setState } = usePermission('notifications')
  const [snoozed, setSnoozed] = useState<boolean | null>(snoozeable ? null : false)

  useEffect(() => {
    if (!snoozeable) return
    let active = true
    storage
      .getItem(SNOOZE_KEY)
      .then((raw) => {
        if (active) setSnoozed(raw != null && Number(raw) > Date.now())
      })
      .catch(() => active && setSnoozed(false))
    return () => {
      active = false
    }
  }, [snoozeable])

  if (!state || !needsFix(state) || snoozed !== false) return null

  const fix = async () =>
    setState(await fixPermission('notifications', state, session?.email ?? ''))

  const later = () => {
    setSnoozed(true)
    void storage.setItem(SNOOZE_KEY, String(Date.now() + BANNER_SNOOZE_MS)).catch(() => undefined)
  }

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.text}>{message}</Text>
      <View style={styles.actions}>
        {snoozeable ? (
          <TouchableOpacity onPress={later} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.later}>Later</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={() => void fix()} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.fix}>{fixLabel(state)}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.background,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    borderRadius: borderRadius.medium,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  text: { fontSize: fontSize.medium, color: colors.textPrimary, fontWeight: '600' },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  later: { fontSize: fontSize.medium, color: colors.textSecondary, fontWeight: '600' },
  fix: { fontSize: fontSize.medium, color: colors.primary, fontWeight: '700' },
})
