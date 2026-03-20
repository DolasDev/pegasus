import { Stack } from 'expo-router';
import { colors, fontSize } from '../../src/theme/colors';

export default function OrderLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
