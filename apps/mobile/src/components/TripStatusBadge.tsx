import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, fontSize, spacing, borderRadius } from '../theme/colors'

// ---------------------------------------------------------------------------
// Status pill for longhaul trips. Unlike the Move StatusBadge, longhaul trip
// statuses are free-form strings sourced from the legacy MasterTripStatus
// table, so we color-map by name with a sensible default.
// ---------------------------------------------------------------------------

interface TripStatusBadgeProps {
  status: string | null | undefined
  size?: 'small' | 'large'
}

function colorForStatus(status: string): { bg: string; fg: string } {
  switch (status.trim().toLowerCase()) {
    case 'offered':
      return { bg: colors.warning, fg: colors.textPrimary }
    case 'accepted':
      return { bg: colors.inTransit, fg: colors.textLight }
    case 'in-progress':
    case 'in progress':
      return { bg: colors.inTransit, fg: colors.textLight }
    case 'finalized':
    case 'completed':
      return { bg: colors.delivered, fg: colors.textLight }
    case 'pending':
      return { bg: colors.pending, fg: colors.textPrimary }
    default:
      return { bg: colors.backgroundLight, fg: colors.textSecondary }
  }
}

export function TripStatusBadge({ status, size = 'small' }: TripStatusBadgeProps) {
  const label = (status ?? 'Unknown').trim() || 'Unknown'
  const { bg, fg } = colorForStatus(label)
  const isLarge = size === 'large'
  return (
    <View style={[styles.badge, { backgroundColor: bg }, isLarge && styles.badgeLarge]}>
      <Text style={[styles.text, { color: fg }, isLarge && styles.textLarge]}>
        {label.toUpperCase()}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.small,
    alignSelf: 'flex-start',
  },
  badgeLarge: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.medium,
  },
  text: {
    fontSize: fontSize.small,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  textLarge: {
    fontSize: fontSize.large,
    letterSpacing: 1,
  },
})
