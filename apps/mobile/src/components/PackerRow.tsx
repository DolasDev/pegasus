import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import type { LaborPacker } from '../types/labor'
import { colors, fontSize, spacing, touchTarget } from '../theme/colors'

interface PackerRowProps {
  packer: LaborPacker
  onPress: () => void
  onLongPress?: () => void
}

/** "CID 12345 · issued 2024-03-01", the email, the phone — whatever is known. */
export function packerDetails(p: LaborPacker): string[] {
  const lines: string[] = []
  if (p.cidNumber) {
    lines.push(
      p.cidIssuedOn ? `CID ${p.cidNumber} · issued ${p.cidIssuedOn}` : `CID ${p.cidNumber}`,
    )
  }
  if (p.email) lines.push(p.email)
  if (p.phoneDisplay) lines.push(p.phoneDisplay)
  return lines
}

export function PackerRow({ packer, onPress, onLongPress }: PackerRowProps) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Packer ${packer.firstName} ${packer.lastName}`}
      accessibilityHint="Tap to edit, long-press to delete"
    >
      <Text style={styles.name}>
        {packer.firstName} {packer.lastName}
      </Text>
      {packerDetails(packer).map((line) => (
        <Text key={line} style={styles.detail} numberOfLines={1}>
          {line}
        </Text>
      ))}
      <View style={styles.divider} />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  row: { minHeight: touchTarget.minHeight, paddingTop: spacing.sm, justifyContent: 'center' },
  name: { fontSize: fontSize.medium, fontWeight: '600', color: colors.textPrimary },
  detail: { fontSize: fontSize.small, color: colors.textSecondary, marginTop: 2 },
  divider: { marginTop: spacing.sm, height: 1, backgroundColor: colors.border },
})
