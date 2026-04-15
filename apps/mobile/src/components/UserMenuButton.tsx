import React, { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  TouchableWithoutFeedback,
  Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../context/AuthContext'
import { colors, fontSize, spacing, borderRadius } from '../theme/colors'

function initialsFor(email: string | undefined): string {
  if (!email) return '?'
  const name = email.split('@')[0] ?? ''
  const parts = name.split(/[._-]+/).filter(Boolean)
  const letters = parts.length >= 2 ? parts[0]![0]! + parts[1]![0]! : name.slice(0, 2)
  return letters.toUpperCase() || '?'
}

export function UserMenuButton() {
  const { session, logout } = useAuth()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const displayName = session?.email ?? 'Driver'
  const initials = initialsFor(session?.email)

  const handleSettings = () => {
    setOpen(false)
    router.push('/settings')
  }

  const handleLogout = () => {
    setOpen(false)
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => void logout() },
    ])
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.trigger}
        accessibilityRole="button"
        accessibilityLabel="Open user menu"
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setOpen(false)}>
          <View style={styles.backdrop}>
            <TouchableWithoutFeedback>
              <View style={styles.menu}>
                <View style={styles.menuHeader}>
                  <Text style={styles.menuName} numberOfLines={1}>
                    {displayName}
                  </Text>
                  {session?.role ? <Text style={styles.menuRole}>{session.role}</Text> : null}
                </View>
                <Pressable
                  style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                  onPress={handleSettings}
                  accessibilityRole="button"
                >
                  <Text style={styles.menuItemText}>Settings</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                  onPress={handleLogout}
                  accessibilityRole="button"
                >
                  <Text style={[styles.menuItemText, styles.menuItemDestructive]}>Logout</Text>
                </Pressable>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  trigger: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.textLight,
    fontWeight: '700',
    fontSize: fontSize.medium,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingTop: 70,
    paddingRight: spacing.md,
    alignItems: 'flex-end',
  },
  menu: {
    minWidth: 220,
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    borderWidth: 2,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  menuHeader: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuName: {
    fontSize: fontSize.medium,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  menuRole: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    marginTop: 2,
  },
  menuItem: {
    padding: spacing.md,
  },
  menuItemPressed: {
    backgroundColor: colors.backgroundLight,
  },
  menuItemText: {
    fontSize: fontSize.large,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  menuItemDestructive: {
    color: colors.error,
  },
})
