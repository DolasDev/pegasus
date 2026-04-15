import React, { useEffect, useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Stack, SplashScreen } from 'expo-router'
import { AuthProvider, useAuth } from '../src/context/AuthContext'
import { isConfigValid } from '../src/config'
import { getAuthService } from '../src/auth/authServiceInstance'
import { colors, fontSize, spacing } from '../src/theme/colors'

SplashScreen.preventAutoHideAsync()

function RootLayoutNav() {
  const { isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync()
  }, [isLoading])

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(drawer)" />
        <Stack.Screen name="order" />
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
