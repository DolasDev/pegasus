import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, fontSize, spacing, borderRadius } from '../theme/colors'

// ---------------------------------------------------------------------------
// Pill showing whether a delivery ETA is Confirmed — i.e. the driver AND the
// shipper have committed to it. Worded "with shipper" on purpose so it can't
// be read as dispatch's own confirmation or as "confirmed availability".
// ---------------------------------------------------------------------------

export function CommitmentBadge({ committed }: { committed: boolean }) {
  return (
    <View
      style={[styles.badge, committed ? styles.committed : styles.open]}
      accessibilityLabel={committed ? 'Confirmed with shipper' : 'Not confirmed'}
    >
      <Text style={[styles.text, committed ? styles.committedText : styles.openText]}>
        {committed ? '✓ CONFIRMED WITH SHIPPER' : 'NOT CONFIRMED'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.small,
    alignSelf: 'flex-start',
  },
  committed: { backgroundColor: colors.success },
  open: { backgroundColor: colors.backgroundLight, borderWidth: 1, borderColor: colors.borderDark },
  text: { fontSize: fontSize.small, fontWeight: '700', letterSpacing: 0.5 },
  committedText: { color: colors.textLight },
  openText: { color: colors.textSecondary },
})
