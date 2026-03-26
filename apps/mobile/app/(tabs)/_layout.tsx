import { Tabs } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, fontSize } from '../../src/theme/colors'

export default function TabLayout() {
  const insets = useSafeAreaInsets()

  // Ensure minimum padding for Android devices without insets
  const bottomPadding = Math.max(insets.bottom, 20)

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          height: 70 + bottomPadding,
          paddingBottom: bottomPadding,
          paddingTop: 10,
          borderTopWidth: 2,
          borderTopColor: colors.border,
          backgroundColor: colors.background,
        },
        tabBarLabelStyle: {
          fontSize: fontSize.medium,
          fontWeight: '600',
          marginBottom: 8,
        },
        headerStyle: {
          backgroundColor: colors.backgroundDark,
        },
        headerTintColor: colors.textLight,
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: fontSize.xlarge,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarLabel: 'Orders',
          tabBarIcon: () => null,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarLabel: 'Settings',
          tabBarIcon: () => null,
        }}
      />
    </Tabs>
  )
}
