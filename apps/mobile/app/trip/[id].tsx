import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { TripStatusBadge } from '../../src/components/TripStatusBadge'
import { TripService } from '../../src/services/tripService'
import { formatLonghaulDate, formatLonghaulSpread } from '../../src/utils/longhaul-format'
import type { LonghaulTripDetail, LonghaulShipment } from '../../src/types/longhaul'
import { colors, fontSize, spacing, borderRadius } from '../../src/theme/colors'

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [trip, setTrip] = useState<LonghaulTripDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      if (!id) return
      setIsLoading(true)
      setError(null)
      try {
        const data = await TripService.getTrip(id)
        if (active) setTrip(data)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load trip')
      } finally {
        if (active) setIsLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [id])

  if (isLoading) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <Stack.Screen options={{ title: `Trip ${id}` }} />
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    )
  }

  if (error || !trip) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <Stack.Screen options={{ title: `Trip ${id}` }} />
        <Text style={styles.emptyTitle}>Couldn’t load trip</Text>
        <Text style={styles.emptySubtext}>{error ?? 'Trip not found.'}</Text>
      </SafeAreaView>
    )
  }

  const shipments = trip.shipments ?? []
  const weight = trip.total_actual_lbs ?? trip.total_estimated_lbs

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: `Trip ${trip.id}` }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryTitle} numberOfLines={2}>
              Trip {trip.id}
              {trip.trip_title ? ` · ${trip.trip_title}` : ''}
            </Text>
            <TripStatusBadge status={trip.status_status} />
          </View>
          <Text style={styles.driver}>{trip.driver_name?.trim() || 'Unassigned'}</Text>

          <View style={styles.grid}>
            <Field
              label="Start"
              value={formatLonghaulDate(trip.actual_first_day ?? trip.planned_first_day)}
            />
            <Field
              label="End"
              value={formatLonghaulDate(trip.actual_last_day ?? trip.planned_last_day)}
            />
            <Field label="Origin" value={trip.origin_geo_code ?? '—'} />
            <Field label="Destination" value={trip.destination_geo_code ?? '—'} />
            <Field label="Weight" value={weight == null ? '—' : weight.toLocaleString('en-US')} />
            <Field label="Days" value={trip.total_days == null ? '—' : String(trip.total_days)} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>SHIPMENTS ({shipments.length})</Text>

        {shipments.length === 0 ? (
          <Text style={styles.emptySubtext}>No shipments on this trip.</Text>
        ) : (
          shipments.map((s) => (
            <ShipmentRow
              key={String(s.order_num)}
              shipment={s}
              onPress={() => router.push(`/shipment/${encodeURIComponent(String(s.order_num))}`)}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function ShipmentRow({ shipment, onPress }: { shipment: LonghaulShipment; onPress: () => void }) {
  const origin = [shipment.shipper_city, shipment.shipper_state].filter(Boolean).join(', ')
  const dest = [shipment.consignee_city, shipment.consignee_state].filter(Boolean).join(', ')
  return (
    <TouchableOpacity style={styles.shipmentCard} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.shipmentHeader}>
        <Text style={styles.shipmentOrder}>#{shipment.order_num}</Text>
        <Text style={styles.chevron}>›</Text>
      </View>
      {shipment.shipper_name ? (
        <Text style={styles.shipmentName} numberOfLines={1}>
          {shipment.shipper_name}
        </Text>
      ) : null}
      <Text style={styles.shipmentRoute} numberOfLines={1}>
        {origin || '—'} → {dest || '—'}
      </Text>
      <View style={styles.shipmentDates}>
        <DateChip
          label="Pack"
          value={formatLonghaulSpread(shipment.pack_date2, shipment.plan_pack)}
        />
        <DateChip
          label="Load"
          value={formatLonghaulSpread(shipment.load_date2, shipment.plan_load)}
        />
        <DateChip label="Del" value={formatLonghaulSpread(shipment.del_date2, shipment.plan_del)} />
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

function DateChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.dateChip}>
      <Text style={styles.dateChipLabel}>{label}</Text>
      <Text style={styles.dateChipValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLight },
  content: { padding: spacing.md },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.backgroundLight,
  },
  summaryCard: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  summaryTitle: {
    flex: 1,
    fontSize: fontSize.large,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  driver: {
    fontSize: fontSize.medium,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  field: { width: '50%', marginBottom: spacing.sm },
  fieldLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  fieldValue: {
    fontSize: fontSize.medium,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sectionTitle: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  shipmentCard: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  shipmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  shipmentOrder: {
    fontSize: fontSize.large,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  chevron: {
    fontSize: fontSize.xxlarge,
    color: colors.textSecondary,
  },
  shipmentName: {
    fontSize: fontSize.medium,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  shipmentRoute: {
    fontSize: fontSize.medium,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  shipmentDates: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  dateChip: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
    borderRadius: borderRadius.medium,
    padding: spacing.sm,
  },
  dateChipLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  dateChipValue: {
    fontSize: fontSize.small,
    color: colors.textPrimary,
    marginTop: 2,
  },
  emptyTitle: {
    fontSize: fontSize.xlarge,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: fontSize.medium,
    color: colors.textSecondary,
    textAlign: 'center',
  },
})
