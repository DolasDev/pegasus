import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useActivity } from '../context/ActivityContext'
import { colors, fontSize } from '../theme/colors'

/** The header bell: opens Activity, with the unseen count as a badge. */
export function ActivityBell() {
  const router = useRouter()
  const { unseen } = useActivity()
  const label = unseen > 0 ? `Activity, ${unseen} new` : 'Activity'
  return (
    <Pressable
      onPress={() => router.push('/activity')}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
    >
      <Text style={styles.bell}>🔔</Text>
      {unseen > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unseen > 99 ? '99+' : unseen}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: 8, paddingVertical: 4 },
  bell: { fontSize: 22, color: colors.textLight },
  badge: {
    position: 'absolute',
    top: -2,
    right: 0,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: fontSize.small, fontWeight: '700', color: colors.textLight },
})
