import 'react-native-get-random-values'

import { useEffect } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { AuthProvider, useAuth } from '../src/context/AuthContext'
import { createAuthService } from '../src/auth/authService'
import * as cognitoService from '../src/auth/cognitoService'
import { View, ActivityIndicator, StyleSheet } from 'react-native'
import { colors } from '../src/theme/colors'

export const authService = createAuthService({
  apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  cognitoService,
})

function RootLayoutNav() {
  const { isAuthenticated, isLoading } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (isLoading) return

    const inAuthGroup = segments[0] === '(auth)'

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login')
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)')
    }
  }, [isAuthenticated, isLoading, segments])

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    )
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="order" options={{ headerShown: true }} />
    </Stack>
  )
}

export default function RootLayout() {
  return (
    <AuthProvider authService={authService}>
      <RootLayoutNav />
    </AuthProvider>
  )
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
})
