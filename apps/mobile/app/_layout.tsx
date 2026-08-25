import React, { useEffect, useMemo } from 'react'
import { View, Text, StyleSheet, AppState } from 'react-native'
import { Stack, SplashScreen, useRouter } from 'expo-router'
import { AuthProvider, useAuth } from '../src/context/AuthContext'
import { isConfigValid } from '../src/config'
import { getAuthService } from '../src/auth/authServiceInstance'
import {
  initNotifications,
  registerForPush,
  setupNotificationTapHandler,
} from '../src/services/pushNotifications'
import { colors, fontSize, spacing } from '../src/theme/colors'

SplashScreen.preventAutoHideAsync()

/**
 * Header options for the screens pushed on top of the drawer.
 *
 * These screens deliberately live on THIS stack rather than in nested
 * single-screen stacks of their own. On iOS the header's back chevron is
 * UIKit's, drawn only when the view controller is not the first in its
 * UINavigationController — react-native-screens can hide that button but
 * cannot conjure one. A nested stack holding a single screen is therefore
 * always at index 0, so it renders no chevron no matter what the header
 * options say. Kept flat here, each screen is a real second entry of the same
 * native stack as `(drawer)`, and the chevron, the "Back" label and the
 * left-edge swipe all come for free.
 */
const detailHeader = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.backgroundDark },
  headerTintColor: colors.textLight,
  headerTitleStyle: { fontWeight: '700', fontSize: fontSize.large },
  headerBackTitle: 'Back',
} as const

function RootLayoutNav() {
  const { isAuthenticated, isLoading, session } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync()
  }, [isLoading])

  // The API client's bearer token is bound by AuthProvider, synchronously with
  // every session transition — NOT by an effect here. An effect on this layout
  // runs after its own descendants' mount effects, so the first authenticated
  // request of a cold start (TripsProvider's /me/driver) beat it and went out
  // unauthenticated. See the applySession comment in AuthContext.

  // One-time notification setup: foreground handler + Android channel, and route
  // notification taps to their deep-link target.
  useEffect(() => {
    initNotifications()
    const sub = setupNotificationTapHandler((path) => router.push(path))
    return () => sub.remove()
  }, [router])

  // Register this device for push once the driver is authenticated, and RETRY
  // whenever the app returns to the foreground.
  //
  // The retry is not belt-and-braces. Registration can fail for reasons that
  // are transient and entirely outside the app — most commonly the Expo token
  // mint right after an app-data clear, while Play Services re-establishes FCM.
  // Firing only on the auth transition meant one such failure disabled push for
  // the whole session: the effect never re-ran, because a restored session
  // leaves `isAuthenticated` already true, so even force-quitting and
  // reopening the app changed nothing. Re-registering is cheap and idempotent —
  // it short-circuits on the per-account cache once it has succeeded.
  const accountKey = session?.email ?? ''
  useEffect(() => {
    if (!isAuthenticated) return
    registerForPush(accountKey)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') registerForPush(accountKey)
    })
    return () => sub.remove()
  }, [isAuthenticated, accountKey])

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(drawer)" />
        <Stack.Screen name="trip/[id]" options={{ ...detailHeader, title: 'Trip' }} />
        <Stack.Screen name="shipment/[orderNum]" options={{ ...detailHeader, title: 'Shipment' }} />
        <Stack.Screen name="settings" options={{ ...detailHeader, title: 'Settings' }} />
      </Stack.Protected>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  )
}

function ConfigErrorScreen() {
  return (
    <View style={styles.errorContainer}>
      <Text style={styles.errorTitle}>Configuration Error</Text>
      <Text style={styles.errorMessage}>
        Required environment variables are missing. Please check your .env file or EAS build
        profile.
      </Text>
    </View>
  )
}

export default function RootLayout() {
  const configValid = isConfigValid()

  const authService = useMemo(() => {
    if (!configValid) return null
    return getAuthService()
  }, [configValid])

  if (!configValid || !authService) {
    return <ConfigErrorScreen />
  }

  return (
    <AuthProvider authService={authService}>
      <RootLayoutNav />
    </AuthProvider>
  )
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  errorTitle: {
    fontSize: fontSize.xlarge,
    fontWeight: '700',
    color: colors.error,
    marginBottom: spacing.md,
  },
  errorMessage: {
    fontSize: fontSize.large,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
})
