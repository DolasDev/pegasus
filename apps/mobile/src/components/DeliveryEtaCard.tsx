import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { colors, fontSize, spacing, borderRadius } from '../theme/colors'
import type { LonghaulActivity } from '../types/longhaul'
import { CommitmentBadge } from './CommitmentBadge'
import {
  activityHasEta,
  completedOn,
  etaActivityLabel,
  formatArrivalWindow,
  formatEtaDate,
  isCommitted,
} from '../utils/driver-eta'
import { formatLonghaulSpread } from '../utils/longhaul-format'

// ---------------------------------------------------------------------------
// One Delivery / SIT-IN activity on the trip screen: its ETA, arrival window
// and whether it is Confirmed with the shipper. Tapping it opens the editor —
// unless the delivery already has an actual date, when the card is read-only.
// ---------------------------------------------------------------------------

interface Props {
  activity: LonghaulActivity
  shipperName?: string | null
  onPress: () => void
}

export function DeliveryEtaCard({ activity, shipperName, onPress }: Props) {
  const committed = isCommitted(activity)
  const hasEta = activityHasEta(activity)
  const window = formatArrivalWindow(
    activity.arrival_window_start,
    activity.arrival_window_end,
    activity.arrival_window_tz,
  )
  const label = etaActivityLabel(activity)
  const doneOn = completedOn(activity)
  const orderSuffix = activity.order_num ? ` #${activity.order_num}` : ''
  return (
    <TouchableOpacity
      style={[styles.card, committed && styles.cardCommitted]}
      onPress={onPress}
      disabled={doneOn != null}
      activeOpacity={0.7}
      accessibilityLabel={
        doneOn
          ? `${label}${orderSuffix}, delivered`
          : `${hasEta ? 'Set ETA' : 'Set arrival window'} for ${label}${orderSuffix}`
      }
    >
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {label}
          {activity.order_num ? ` · #${activity.order_num}` : ''}
        </Text>
        {doneOn ? (
          <Text style={styles.done}>Delivered</Text>
        ) : (
          <Text style={styles.action}>{hasEta ? 'Set ETA ›' : 'Set window ›'}</Text>
        )}
      </View>
      {shipperName ? (
        <Text style={styles.sub} numberOfLines={1}>
          {shipperName}
        </Text>
      ) : null}
      <Text style={styles.sub}>
        Spread: {formatLonghaulSpread(activity.planned_start, activity.planned_end)}
      </Text>
      {hasEta ? (
        <Text style={styles.eta}>
          ETA: {activity.estimated_date ? formatEtaDate(activity.estimated_date) : 'Not set'}
        </Text>
      ) : null}
      <Text style={styles.sub}>Arrival window: {window ?? 'Not set'}</Text>
      {doneOn ? (
        <Text style={styles.sub}>
          Delivered {formatEtaDate(doneOn)} — ask dispatch if this ETA needs to change.
        </Text>
      ) : null}
      <View style={styles.badgeRow}>
        <CommitmentBadge committed={committed} />
      </View>
      {committed ? (
        <Text style={styles.commitNote}>You and the shipper have committed to this date.</Text>
      ) : null}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  cardCommitted: { borderColor: colors.success },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { flex: 1, fontSize: fontSize.large, fontWeight: '700', color: colors.textPrimary },
  action: { fontSize: fontSize.medium, fontWeight: '700', color: colors.brand },
  done: { fontSize: fontSize.medium, fontWeight: '700', color: colors.textSecondary },
  sub: { fontSize: fontSize.medium, color: colors.textSecondary },
  eta: { fontSize: fontSize.medium, fontWeight: '700', color: colors.textPrimary },
  badgeRow: { marginTop: spacing.xs },
  commitNote: { fontSize: fontSize.small, color: colors.success, fontWeight: '600' },
})
