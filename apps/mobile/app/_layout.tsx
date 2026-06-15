import React, { useEffect, useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Stack, SplashScreen, useRouter } from 'expo-router'
import { AuthProvider, useAuth } from '../src/context/AuthContext'
import { isConfigValid } from '../src/config'
import { getAuthService } from '../src/auth/authServiceInstance'
import { setTokenProvider } from '../src/api/client'
import {
  initNotifications,
  registerForPush,
  setupNotificationTapHandler,
} from '../src/services/pushNotifications'
import { colors, fontSize, spacing } from '../src/theme/colors'

SplashScreen.preventAutoHideAsync()

function RootLayoutNav() {
  const { isAuthenticated, isLoading, session } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync()
  }, [isLoading])

  // Bind the API client's bearer token to the current session. Without this no
  // authenticated request (including push registration) can attach a token.
  useEffect(() => {
    setTokenProvider(() => session?.token ?? null)
  }, [session])

  // One-time notification setup: foreground handler + Android channel, and route
  // notification taps to their deep-link target.
  useEffect(() => {
    initNotifications()
    const sub = setupNotificationTapHandler((path) => router.push(path))
    return () => sub.remove()
  }, [router])

  // Register this device for push once the driver is authenticated (and again on
  // any later auth transition). Logout-side deactivation lives in AuthContext so
  // it runs while the session token is still valid.
  useEffect(() => {
    if (isAuthenticated) registerForPush()
  }, [isAuthenticated])

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(drawer)" />
        <Stack.Screen name="order" />
        <Stack.Screen name="trip" />
        <Stack.Screen name="shipment" />
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
