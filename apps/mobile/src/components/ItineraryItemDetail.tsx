import React from 'react'
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { ItineraryItem } from '../types/itinerary'
import { formatDay, formatWindow, placeLines } from '../utils/itinerary'
import { colors, fontSize, spacing, borderRadius } from '../theme/colors'

// ---------------------------------------------------------------------------
// Read-only detail for a local dispatch job act, rendered from the itinerary
// row itself. A local job does not open the shipment screen: that screen reads
// /onprem/longhaul/shipments, whose driver scope is longhaul activities only,
// so a driver whose only work on the order is a local job would be refused.
// ---------------------------------------------------------------------------

interface Props {
  item: ItineraryItem | null
  onClose: () => void
}

type Row = { label: string; value: string }

function detailRows(item: ItineraryItem): Row[] {
  const { line1, line2 } = placeLines(item.place)
  const rows: Row[] = [
    { label: 'Order', value: `#${item.orderNum}` },
    { label: 'Shipper', value: item.shipperName ?? '—' },
    { label: 'Day', value: formatDay(item.day) },
    { label: 'Address', value: [line1, line2].filter(Boolean).join('\n') || '—' },
  ]
  if (item.placeNote) rows.push({ label: 'Dispatcher note', value: item.placeNote })
  if (item.arrivalWindow) {
    rows.push({
      label: 'Arrival window',
      value: formatWindow(item.arrivalWindow),
    })
  }
  rows.push({
    label: 'Status',
    value: item.actual ? 'Done' : item.confirmed ? 'Confirmed' : 'Scheduled',
  })
  return rows
}

export function ItineraryItemDetail({ item, onClose }: Props) {
  return (
    <Modal visible={item != null} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Local job</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Text style={styles.headerAction}>Close</Text>
          </TouchableOpacity>
        </View>
        {item ? (
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.title}>{item.actName}</Text>
            {!item.known && item.actCode ? (
              <Text style={styles.hint}>
                “{item.actCode}” was typed in by the dispatcher — ask them what it means.
              </Text>
            ) : null}
            <View style={styles.card}>
              {detailRows(item).map((row) => (
                <View key={row.label} style={styles.row}>
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  <Text style={styles.rowValue}>{row.value}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLight },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.backgroundDark,
  },
  headerTitle: { color: colors.textLight, fontSize: fontSize.xlarge, fontWeight: '700' },
  headerAction: { color: colors.textLight, fontSize: fontSize.large, fontWeight: '600' },
  body: { padding: spacing.md, gap: spacing.md },
  title: { fontSize: fontSize.xlarge, fontWeight: '700', color: colors.textPrimary },
  hint: { fontSize: fontSize.medium, color: colors.textSecondary },
  card: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  row: { gap: spacing.xs },
  rowLabel: { fontSize: fontSize.small, color: colors.textSecondary, fontWeight: '600' },
  rowValue: { fontSize: fontSize.large, color: colors.textPrimary },
})
