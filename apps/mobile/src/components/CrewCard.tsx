import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { StarRating } from './StarRating'
import type { LaborCrew } from '../types/labor'
import { colors, fontSize, spacing, borderRadius } from '../theme/colors'

// ---------------------------------------------------------------------------
// One crew in the Labor list: name (my nickname wins), phone, the first few
// service areas, MY stars (only for a crew in my own list), a "Company" tag
// when it's on the company list, and the anonymous average once 3+ drivers rated.
// ---------------------------------------------------------------------------

const AREAS_SHOWN = 3

interface CrewCardProps {
  crew: LaborCrew
  onPress: () => void
}

export function areasSummary(crew: LaborCrew): string | null {
  if (!crew.serviceAreas.length) return null
  const shown = crew.serviceAreas.slice(0, AREAS_SHOWN).map((a) => `${a.city}, ${a.region}`)
  const more = crew.serviceAreas.length - shown.length
  return more > 0 ? `${shown.join(' · ')} +${more}` : shown.join(' · ')
}

export function CrewCard({ crew, onPress }: CrewCardProps) {
  const areas = areasSummary(crew)
  const distance = crew.distanceMiles

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Crew ${crew.displayName}`}
    >
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {crew.displayName}
        </Text>
        {distance != null ? <Text style={styles.distance}>{formatMiles(distance)}</Text> : null}
      </View>

      <Text style={styles.phone}>{crew.phoneDisplay}</Text>
      {areas ? (
        <Text style={styles.areas} numberOfLines={1}>
          {areas}
        </Text>
      ) : null}

      <View style={styles.footer}>
        {crew.inMyList ? <StarRating value={crew.myRating?.stars ?? null} /> : null}
        {crew.inCompanyList ? <Text style={styles.tag}>Company</Text> : null}
        {crew.averageRating ? (
          <Text style={styles.average}>
            avg {crew.averageRating.average.toFixed(1)} ({crew.averageRating.count})
          </Text>
        ) : null}
        <Text style={styles.packers}>
          {crew.packerCount} packer{crew.packerCount === 1 ? '' : 's'}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

export function formatMiles(miles: number): string {
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { flex: 1, fontSize: fontSize.large, fontWeight: '700', color: colors.textPrimary },
  distance: {
    marginLeft: spacing.sm,
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.brand,
  },
  phone: { marginTop: 2, fontSize: fontSize.medium, color: colors.textSecondary },
  areas: { marginTop: 2, fontSize: fontSize.small, color: colors.textSecondary },
  footer: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tag: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.brand,
  },
  average: { fontSize: fontSize.small, color: colors.textSecondary },
  packers: { marginLeft: 'auto', fontSize: fontSize.small, color: colors.textSecondary },
})
