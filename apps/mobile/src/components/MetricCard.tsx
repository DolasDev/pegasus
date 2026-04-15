import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, fontSize, spacing, borderRadius } from '../theme/colors'

interface MetricCardProps {
  label: string
  value: string
  subtitle?: string
  accent?: string
}

export function MetricCard({ label, value, subtitle, accent }: MetricCardProps) {
  return (
    <View style={[styles.card, accent ? { borderLeftColor: accent, borderLeftWidth: 4 } : null]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
    minHeight: 110,
    justifyContent: 'space-between',
  },
  label: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  value: {
    fontSize: fontSize.xxlarge,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
})
