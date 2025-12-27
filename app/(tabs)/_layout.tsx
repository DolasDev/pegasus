import { Tabs } from 'expo-router';
import { colors, fontSize } from '../../src/theme/colors';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          height: 70,
          paddingBottom: 10,
          paddingTop: 10,
          borderTopWidth: 2,
          borderTopColor: colors.border,
          backgroundColor: colors.background,
        },
        tabBarLabelStyle: {
          fontSize: fontSize.medium,
          fontWeight: '600',
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
  );
}
