import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, Stack } from 'expo-router'
import { TripStatusBadge } from '../../src/components/TripStatusBadge'
import { DocumentsTab } from '../../src/components/DocumentsTab'
import { TripService } from '../../src/services/tripService'
import { formatLonghaulDate, formatLonghaulSpread } from '../../src/utils/longhaul-format'
import type { LonghaulShipment } from '../../src/types/longhaul'
import { colors, fontSize, spacing, borderRadius } from '../../src/theme/colors'

// ---------------------------------------------------------------------------
// Curated, read-only shipment detail — mirrors the high-value fields the
// tenant-web operations ShipmentDetail panel shows, grouped for a phone. The
// web inline editors (weight / coverage / comments) are intentionally not
// ported; this is view-only.
// ---------------------------------------------------------------------------

type Row = { label: string; value: string }

function str(value: unknown): string {
  if (value == null || value === '') return '—'
  return String(value)
}

function join(parts: Array<string | null | undefined>, sep = ', '): string {
  const v = parts.filter((p) => p != null && String(p).trim() !== '').join(sep)
  return v || '—'
}

export default function ShipmentDetailScreen() {
  const { orderNum } = useLocalSearchParams<{ orderNum: string }>()
  const [shipment, setShipment] = useState<LonghaulShipment | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'details' | 'documents'>('details')

  useEffect(() => {
    let active = true
    async function load() {
      if (!orderNum) return
      setIsLoading(true)
      setError(null)
      try {
        const data = await TripService.getShipment(orderNum)
        if (active) setShipment(data)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load shipment')
      } finally {
        if (active) setIsLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [orderNum])

  if (isLoading) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <Stack.Screen options={{ title: `#${orderNum}` }} />
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    )
  }

  if (error || !shipment) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <Stack.Screen options={{ title: `#${orderNum}` }} />
        <Text style={styles.emptyTitle}>Couldn’t load shipment</Text>
        <Text style={styles.emptySubtext}>{error ?? 'Shipment not found.'}</Text>
      </SafeAreaView>
    )
  }

  const s = shipment
  const move: Row[] = [
    { label: 'Account', value: str(s.ba_name) },
    { label: 'Move', value: str(s.move_desc) },
    { label: 'Booker', value: str(s.booker_name) },
    { label: 'Driver', value: str(s.driver_name) },
    { label: 'Trip', value: s.TripMaster_id == null ? '—' : `#${s.TripMaster_id}` },
  ]
  const dates: Row[] = [
    { label: 'Pack (spread)', value: formatLonghaulSpread(s.pack_date2, s.plan_pack) },
    { label: 'Pack (actual)', value: formatLonghaulDate(s.pack_actual) },
    { label: 'Load (spread)', value: formatLonghaulSpread(s.load_date2, s.plan_load) },
    { label: 'Load (actual)', value: formatLonghaulDate(s.load_actual) },
    { label: 'SIT', value: formatLonghaulDate(s.sit_date) },
    { label: 'Delivery (spread)', value: formatLonghaulSpread(s.del_date2, s.plan_del) },
    { label: 'Delivery (actual)', value: formatLonghaulDate(s.del_actual) },
  ]
  const locations: Row[] = [
    { label: 'Origin', value: join([s.origin_address1, s.origin_address2]) },
    {
      label: 'Origin city',
      value: join([join([s.shipper_city, s.shipper_state], ', '), s.origin_zip], ' '),
    },
    { label: 'Destination', value: join([s.destination_address1, s.destination_address2]) },
    {
      label: 'Destination city',
      value: join([join([s.consignee_city, s.consignee_state], ', '), s.destination_zip], ' '),
    },
  ]
  const weight: Row[] = [
    { label: 'Est weight', value: str(s.total_est_wt) },
    { label: 'Actual weight', value: str(s.pegasus_shadow?.weight) },
  ]
  const notes: Row[] = [
    { label: 'Special instructions', value: str(s.disp_instructions) },
    { label: 'Survey remarks', value: str(s.survey_remarks) },
    { label: 'Long distance instructions', value: str(s.pegasus_shadow?.lng_dis_comments) },
  ]

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: `#${s.order_num}` }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerCard}>
          <View style={styles.headerRow}>
            <Text style={styles.orderNum}>#{s.order_num}</Text>
            {s.status_status ? <TripStatusBadge status={s.status_status} /> : null}
          </View>
          {s.shipper_name ? <Text style={styles.shipper}>{s.shipper_name}</Text> : null}
        </View>

        <View style={styles.tabBar}>
          <Tab label="Details" active={tab === 'details'} onPress={() => setTab('details')} />
          <Tab label="Documents" active={tab === 'documents'} onPress={() => setTab('documents')} />
        </View>

        {tab === 'details' ? (
          <>
            <Section title="Move" rows={move} />
            <Section title="Key dates" rows={dates} />
            <Section title="Locations" rows={locations} stacked />
            <Section title="Weight" rows={weight} />
            <Section title="Notes" rows={notes} stacked />
          </>
        ) : (
          <DocumentsTab orderNum={s.order_num} />
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.tab, active && styles.tabActive]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  )
}

function Section({ title, rows, stacked }: { title: string; rows: Row[]; stacked?: boolean }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      <View style={styles.card}>
        {rows.map((r, i) => (
          <View
            key={r.label}
            style={[
              styles.row,
              stacked && styles.rowStacked,
              i === rows.length - 1 && styles.rowLast,
            ]}
          >
            <Text style={[styles.label, stacked && styles.labelStacked]}>{r.label}</Text>
            <Text style={[styles.value, stacked && styles.valueStacked]}>{r.value}</Text>
          </View>
        ))}
      </View>
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
  headerCard: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderNum: {
    fontSize: fontSize.xxlarge,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  shipper: {
    fontSize: fontSize.large,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  tabBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  tabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabText: { fontSize: fontSize.medium, fontWeight: '600', color: colors.textPrimary },
  tabTextActive: { color: colors.textLight },
  section: { marginBottom: spacing.lg },
  sectionTitle: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    borderWidth: 2,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowStacked: {
    flexDirection: 'column',
    gap: spacing.xs,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  label: {
    fontSize: fontSize.medium,
    fontWeight: '600',
    color: colors.textSecondary,
    flexShrink: 0,
  },
  labelStacked: {
    fontSize: fontSize.small,
    letterSpacing: 0.3,
  },
  value: {
    fontSize: fontSize.medium,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'right',
  },
  valueStacked: {
    textAlign: 'left',
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
