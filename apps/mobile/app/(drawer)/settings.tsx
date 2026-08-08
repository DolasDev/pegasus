import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native'
import { useAuth } from '../../src/context/AuthContext'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../../src/theme/colors'
import Constants from 'expo-constants'
import {
  loadPushRegistrationState,
  type PushRegistrationState,
} from '../../src/services/pushNotifications'

/** One-line, human-readable rendering of the last push-registration outcome. */
function describePushState(s: PushRegistrationState): string {
  switch (s.status) {
    case 'registered':
      return 'Registered'
    case 'skipped':
      return `Not registered — ${s.reason}`
    case 'failed':
      return `Failed — ${s.reason}`
    default:
      return 'Not registered yet'
  }
}

export default function SettingsScreen() {
  const { session, logout } = useAuth()

  // Push registration fails silently by design (it must never break startup),
  // which previously left no way to tell a working device from a broken one
  // without pulling logs off the handset. Surfacing the last outcome here makes
  // it self-diagnosable.
  const [pushState, setPushState] = useState<PushRegistrationState>({ status: 'unknown' })
  useEffect(() => {
    let active = true
    loadPushRegistrationState().then((s) => {
      if (active) setPushState(s)
    })
    return () => {
      active = false
    }
  }, [])

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: logout,
      },
    ])
  }

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Account deletion is not available in this demo version. Contact your administrator for account management.',
      [{ text: 'OK' }],
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>DRIVER PROFILE</Text>
        <View style={styles.profileCard}>
          <View style={styles.profileRow}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{session?.email ?? '—'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.profileRow}>
            <Text style={styles.label}>Role</Text>
            <Text style={styles.value}>{session?.role ?? '—'}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>APP INFORMATION</Text>
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Version</Text>
            <Text style={styles.infoValue}>{Constants.expoConfig?.version || '1.0.0'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Build</Text>
            <Text style={styles.infoValue}>Preview</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Notifications</Text>
            <Text style={styles.infoValue}>{describePushState(pushState)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LEGAL</Text>
        <TouchableOpacity
          style={styles.linkButton}
          onPress={() =>
            Alert.alert('Privacy Policy', 'Privacy policy content would be displayed here.')
          }
        >
          <Text style={styles.linkText}>Privacy Policy</Text>
          <Text style={styles.arrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkButton}
          onPress={() =>
            Alert.alert('Terms of Service', 'Terms of service content would be displayed here.')
          }
        >
          <Text style={styles.linkText}>Terms of Service</Text>
          <Text style={styles.arrow}>→</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ACCOUNT ACTIONS</Text>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>LOG OUT</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDeleteAccount}
          activeOpacity={0.8}
        >
          <Text style={styles.deleteText}>DELETE ACCOUNT</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  content: {
    padding: spacing.md,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.md,
    letterSpacing: 1,
  },
  profileCard: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
  },
  profileRow: {
    paddingVertical: spacing.md,
  },
  label: {
    fontSize: fontSize.medium,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  value: {
    fontSize: fontSize.large,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  infoCard: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  infoLabel: {
    fontSize: fontSize.large,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  infoValue: {
    fontSize: fontSize.large,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  linkButton: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.medium,
    padding: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    minHeight: touchTarget.minHeight,
    borderWidth: 2,
    borderColor: colors.border,
  },
  linkText: {
    fontSize: fontSize.large,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  arrow: {
    fontSize: fontSize.xlarge,
    color: colors.primary,
    fontWeight: '700',
  },
  logoutButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.medium,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
    minHeight: touchTarget.minHeight,
    justifyContent: 'center',
  },
  logoutText: {
    fontSize: fontSize.xlarge,
    fontWeight: '700',
    color: colors.textLight,
    letterSpacing: 1,
  },
  deleteButton: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.medium,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.error,
    minHeight: touchTarget.minHeight,
    justifyContent: 'center',
  },
  deleteText: {
    fontSize: fontSize.large,
    fontWeight: '700',
    color: colors.error,
    letterSpacing: 1,
  },
})
