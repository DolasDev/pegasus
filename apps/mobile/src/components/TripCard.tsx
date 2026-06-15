import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { TripStatusBadge } from './TripStatusBadge'
import { formatLonghaulDate } from '../utils/longhaul-format'
import type { LonghaulTrip } from '../types/longhaul'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../theme/colors'

// ---------------------------------------------------------------------------
// Summary card for a longhaul trip — mirrors the tenant-web operations
// TripCard: title line, status pill, and the same start/end/origin/destination
// /weight/days/linehaul summary fields.
// ---------------------------------------------------------------------------

interface TripCardProps {
  trip: LonghaulTrip
  onPress: () => void
}

function num(value: number | null | undefined): string {
  return value == null ? '—' : value.toLocaleString('en-US')
}

export function TripCard({ trip, onPress }: TripCardProps) {
  const start = formatLonghaulDate(trip.actual_first_day ?? trip.planned_first_day)
  const end = formatLonghaulDate(trip.actual_last_day ?? trip.planned_last_day)
  const weight = trip.total_actual_lbs ?? trip.total_estimated_lbs
  const driverName = trip.driver_name?.trim() || 'Unassigned'

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>
          Trip {trip.id}
          {trip.trip_title ? ` · ${trip.trip_title}` : ''}
        </Text>
        <TripStatusBadge status={trip.status_status} />
      </View>

      <Text style={styles.driver} numberOfLines={1}>
        {driverName}
      </Text>

      <View style={styles.grid}>
        <Field label="Start" value={start} />
        <Field label="End" value={end} />
        <Field label="Origin" value={trip.origin_geo_code ?? '—'} />
        <Field label="Destination" value={trip.destination_geo_code ?? '—'} />
        <Field label="Weight" value={num(weight)} />
        <Field label="Days" value={num(trip.total_days)} />
        <Field
          label="Est Linehaul"
          value={
            trip.total_estimated_linehaul_usd == null
              ? '—'
              : `$${num(trip.total_estimated_linehaul_usd)}`
          }
        />
      </View>
    </TouchableOpacity>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 2,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    minHeight: touchTarget.minHeight,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  title: {
    flex: 1,
    fontSize: fontSize.large,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  driver: {
    fontSize: fontSize.medium,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  field: {
    width: '50%',
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  fieldValue: {
    fontSize: fontSize.medium,
    fontWeight: '600',
    color: colors.textPrimary,
  },
})
