import { Stack } from 'expo-router'
import { colors, fontSize } from '../../src/theme/colors'

export default function TripLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.backgroundDark },
        headerTintColor: colors.textLight,
        headerTitleStyle: { fontWeight: '700', fontSize: fontSize.large },
        headerBackTitle: 'Back',
      }}
    >
      <Stack.Screen name="[id]" options={{ title: 'Trip' }} />
    </Stack>
  )
}
