import { Stack } from 'expo-router'
import { colors, fontSize } from '../../src/theme/colors'

export default function ShipmentLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.backgroundDark },
        headerTintColor: colors.textLight,
        headerTitleStyle: { fontWeight: '700', fontSize: fontSize.large },
        headerBackTitle: 'Back',
      }}
    >
      <Stack.Screen name="[orderNum]" options={{ title: 'Shipment' }} />
    </Stack>
  )
}
