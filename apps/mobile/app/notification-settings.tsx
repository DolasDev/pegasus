import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { NotificationChannel } from '@pegasus/domain'
import { ActivityService } from '../src/services/activityService'
import type { NotificationPreferenceRow } from '../src/types/activity'
import { logger } from '../src/utils/logger'
import { PermissionBanner } from '../src/components/PermissionBanner'
import { colors, fontSize, spacing, borderRadius } from '../src/theme/colors'

// ---------------------------------------------------------------------------
// Notification settings — per type, where it goes: Activity + a push to this
// phone, Activity only, or nowhere (`/api/v1/me/notification-preferences`).
// ---------------------------------------------------------------------------

const CHOICES: { channel: NotificationChannel; label: string }[] = [
  { channel: 'push', label: 'Push' },
  { channel: 'feed', label: 'Activity only' },
  { channel: 'off', label: 'Off' },
]

export default function NotificationSettingsScreen() {
  const [rows, setRows] = useState<NotificationPreferenceRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    ActivityService.getPreferences()
      .then(setRows)
      .catch((err) => {
        logger.warn('Failed to load notification settings', err)
        setError('Couldn’t load your notification settings.')
      })
  }, [])

  const choose = async (row: NotificationPreferenceRow, channel: NotificationChannel) => {
    if (row.channel === channel) return
    setBusy(row.type)
    try {
      setRows(await ActivityService.setPreference(row.type, channel))
      setError(null)
    } catch (err) {
      logger.warn('Failed to save a notification setting', err)
      setError('Couldn’t save that change. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  if (!rows) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom', 'left', 'right']}>
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <ActivityIndicator size="large" color={colors.primary} />
        )}
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <PermissionBanner message="Notifications are off on this phone, so “Push” choices below won’t reach you." />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {rows.map((row) => (
          <View key={row.type} style={styles.card}>
            <Text style={styles.label}>{row.label}</Text>
            <View style={styles.choices}>
              {CHOICES.map((c) => {
                const on = row.channel === c.channel
                return (
                  <TouchableOpacity
                    key={c.channel}
                    onPress={() => void choose(row, c.channel)}
                    disabled={busy === row.type}
                    style={[styles.choice, on && styles.choiceOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${row.label}: ${c.label}`}
                  >
                    <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{c.label}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLight },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.backgroundLight,
  },
  content: { padding: spacing.md, gap: spacing.sm },
  error: { fontSize: fontSize.medium, color: colors.error, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  label: { fontSize: fontSize.medium, fontWeight: '600', color: colors.textPrimary },
  choices: { flexDirection: 'row', gap: spacing.sm },
  choice: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.border,
  },
  choiceOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceText: { fontSize: fontSize.medium, color: colors.textPrimary },
  choiceTextOn: { color: colors.textLight, fontWeight: '700' },
})
