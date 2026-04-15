import React from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { Drawer } from 'expo-router/drawer'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { DrawerContent } from '../../src/components/DrawerContent'
import { UserMenuButton } from '../../src/components/UserMenuButton'
import { colors, fontSize } from '../../src/theme/colors'

export default function DrawerLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
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
        <Drawer.Screen name="paperwork" options={{ title: 'Paperwork' }} />
        <Drawer.Screen
          name="settings"
          options={{
            title: 'Settings',
            drawerItemStyle: { display: 'none' },
          }}
        />
      </Drawer>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
