import React, { useEffect } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter, useSegments } from 'expo-router'
import { Drawer } from 'expo-router/drawer'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { DrawerContent } from '../../src/components/DrawerContent'
import { UserMenuButton } from '../../src/components/UserMenuButton'
import { TripsProvider } from '../../src/context/TripsContext'
import { useLaborAccess } from '../../src/auth/laborAccess'
import { colors, fontSize } from '../../src/theme/colors'

export default function DrawerLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <TripsProvider>
        <DrawerNavigator />
      </TripsProvider>
    </GestureHandlerRootView>
  )
}

/**
 * An Operations user who is not a driver has no Dashboard or My Trips (both are
 * fed by /me/driver), so they land on Labor. Whether they are a driver can
 * depend on the /me/driver call, so for an Operations user without the
 * `driver` role the navigator waits for it rather than flashing the Dashboard
 * and redirecting. If that call fails, nothing is hidden (they may be a
 * driver). Everyone else renders at once.
 */
function DrawerNavigator() {
  const { isOperations, pending, operationsOnly } = useLaborAccess()
  const router = useRouter()
  const segments = useSegments() as string[]

  // `/` is the Dashboard (segments: ['(drawer)']); My Trips is ['(drawer)', 'trips'].
  const onDriverScreen =
    segments[0] === '(drawer)' && (segments.length === 1 || segments[1] === 'trips')
  useEffect(() => {
    if (operationsOnly && onDriverScreen) router.replace('/labor')
  }, [operationsOnly, onDriverScreen, router])

  if (isOperations && pending) {
    return (
      <View style={styles.pending}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    )
  }

  return (
    <Drawer
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={({ navigation }) => ({
        headerStyle: { backgroundColor: colors.backgroundDark },
        headerTintColor: colors.textLight,
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: fontSize.xlarge,
        },
        headerLeft: () => (
          <Pressable
            onPress={() => navigation.openDrawer()}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Open navigation drawer"
            hitSlop={12}
          >
            <Text style={styles.hamburger}>☰</Text>
          </Pressable>
        ),
        headerRight: () => <UserMenuButton />,
        drawerActiveTintColor: colors.primary,
        drawerInactiveTintColor: colors.textPrimary,
      })}
    >
      <Drawer.Screen name="index" options={{ title: 'Dashboard' }} />
      <Drawer.Screen name="trips" options={{ title: 'My Trips' }} />
      <Drawer.Screen name="messages" options={{ title: 'Messages' }} />
      <Drawer.Screen name="labor" options={{ title: 'Labor' }} />
    </Drawer>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pending: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerButton: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  hamburger: {
    color: colors.textLight,
    fontSize: 28,
    fontWeight: '700',
  },
})
