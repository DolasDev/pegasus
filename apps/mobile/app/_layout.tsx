import { useEffect } from 'react'
import { Stack, SplashScreen } from 'expo-router'
import { AuthProvider, useAuth } from '../src/context/AuthContext'
import { createAuthService } from '../src/auth/authService'
import * as cognitoService from '../src/auth/cognitoService'
import * as oauthService from '../src/auth/oauthService'

SplashScreen.preventAutoHideAsync()

export const authService = createAuthService({
  apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  cognitoService,
  oauthService,
})

function RootLayoutNav() {
  const { isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync()
  }, [isLoading])

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="order" />
      </Stack.Protected>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
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
