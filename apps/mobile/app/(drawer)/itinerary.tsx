import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ApiError } from '@pegasus/api-http'
import { ItineraryService } from '../../src/services/itineraryService'
import { ItineraryItemDetail } from '../../src/components/ItineraryItemDetail'
import { TripStatusBadge } from '../../src/components/TripStatusBadge'
import type { ItineraryItem, ItinerarySourceName } from '../../src/types/itinerary'
import {
  formatDay,
  formatRange,
  formatWindow,
  groupItinerary,
  isDone,
  isLocalItem,
  localDay,
  placeLines,
  rangeFrom,
  shiftRange,
  stopTitle,
  type DayRange,
  type ItineraryStop,
} from '../../src/utils/itinerary'
import { OFFERED_STATUS } from '../../src/services/tripService'
import { colors, fontSize, spacing, borderRadius } from '../../src/theme/colors'

// ---------------------------------------------------------------------------
// My Itinerary — every act assigned to the driver, longhaul trip activities and
// local dispatch jobs alike, as one list: day → stop (same day + same place) →
// act. The trip is a chip on the act, not the way in.
//
// The driver mapping is the itinerary's own: /me/driver knows only the longhaul
// id, so a local-only driver would look unmapped there. The API's 403
// DRIVER_NOT_MAPPED is the onboarding state.
//
// Read-only. Delivery ETAs are still set from the trip screen; local acts get
// ETA / done in Phase 3.
// ---------------------------------------------------------------------------

type LoadError = { kind: 'unmapped' } | { kind: 'failed'; message: string }

const SOURCE_LABEL: Record<ItinerarySourceName, string> = {
  longhaul: 'trip activities',
  local: 'local jobs',
}

export default function ItineraryScreen() {
  const router = useRouter()
  const [range, setRange] = useState<DayRange>(() => rangeFrom(localDay()))
  const [items, setItems] = useState<ItineraryItem[]>([])
  const [failedSources, setFailedSources] = useState<ItinerarySourceName[]>([])
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<LoadError | null>(null)
  const [selected, setSelected] = useState<ItineraryItem | null>(null)

  // Only the newest request may write state: paging weeks while a retry or a
  // pull-to-refresh is in flight must not land the old week under the new one.
  const latest = useRef(0)

  const load = useCallback(async (r: DayRange) => {
    const id = ++latest.current
    setError(null)
    try {
      const res = await ItineraryService.getMyItinerary(r.from, r.to)
      if (id !== latest.current) return
      setItems(res.items)
      setFailedSources(res.meta.failedSources)
    } catch (err) {
      if (id !== latest.current) return
      setItems([])
      setFailedSources([])
      if (err instanceof ApiError && err.code === 'DRIVER_NOT_MAPPED') {
        setError({ kind: 'unmapped' })
      } else {
        setError({ kind: 'failed', message: err instanceof Error ? err.message : String(err) })
      }
    }
    return id === latest.current
  }, [])

  // Retry / Refresh on a full-screen state goes through here too: show the
  // spinner, not stale copy.
  const loadWithSpinner = useCallback(
    (r: DayRange) => {
      // A pull-to-refresh this supersedes must not keep the spinner hidden.
      setIsRefreshing(false)
      setLoading(true)
      void load(r).then((current) => {
        if (current) setLoading(false)
      })
    },
    [load],
  )

  useEffect(() => {
    loadWithSpinner(range)
    // Unmounting abandons any request in flight.
    return () => {
      latest.current++
    }
  }, [range, loadWithSpinner])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await load(range)
    setIsRefreshing(false)
  }

  const handleRetry = () => loadWithSpinner(range)

  const sections = useMemo(
    () => groupItinerary(items).map((d) => ({ day: d.day, data: d.stops })),
    [items],
  )

  const today = localDay()

  const openItem = (item: ItineraryItem) => {
    if (isLocalItem(item)) setSelected(item)
    else router.push(`/shipment/${item.orderNum}`)
  }

  const rangeBar = (
    <View style={styles.rangeBar}>
      <TouchableOpacity
        onPress={() => setRange((r) => shiftRange(r, -1))}
        style={styles.rangeButton}
        accessibilityRole="button"
        accessibilityLabel="Previous week"
        hitSlop={8}
      >
        <Text style={styles.rangeArrow}>‹</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => setRange(rangeFrom(today))}
        accessibilityRole="button"
        accessibilityLabel="Back to this week"
        disabled={range.from === today}
      >
        <Text style={styles.rangeLabel}>{formatRange(range)}</Text>
        {range.from !== today ? <Text style={styles.rangeHint}>Tap for today</Text> : null}
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => setRange((r) => shiftRange(r, 1))}
        style={styles.rangeButton}
        accessibilityRole="button"
        accessibilityLabel="Next week"
        hitSlop={8}
      >
        <Text style={styles.rangeArrow}>›</Text>
      </TouchableOpacity>
    </View>
  )

  if (loading && !isRefreshing) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
        {rangeBar}
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.centeredText}>Loading your itinerary…</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (error?.kind === 'unmapped') {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom', 'left', 'right']}>
        <Text style={styles.emptyTitle}>No driver linked</Text>
        <Text style={styles.emptySubtext}>
          Your account isn’t linked to a driver yet. Ask your dispatcher to map your login to a
          driver, then tap Refresh.
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryText}>Refresh</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  if (error?.kind === 'failed') {
    return (
      <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
        {rangeBar}
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Couldn’t load your itinerary</Text>
          <Text style={styles.emptySubtext}>{error.message}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      {rangeBar}
      {failedSources.length > 0 ? (
        <View style={styles.partialBanner} accessibilityRole="alert">
          <Text style={styles.partialText}>
            Couldn’t load your {failedSources.map((s) => SOURCE_LABEL[s] ?? s).join(' or ')}. This
            list may be missing work — pull to refresh.
          </Text>
        </View>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(stop) => stop.key}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <View style={styles.dayHeader}>
            <Text style={styles.dayHeaderText}>
              {formatDay(section.day)}
              {section.day === today ? ' · Today' : ''}
            </Text>
          </View>
        )}
        renderItem={({ item: stop }) => (
          <StopCard
            stop={stop}
            onItemPress={openItem}
            onTripPress={(tripId) => router.push(`/trip/${tripId}`)}
          />
        )}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>Nothing scheduled</Text>
            <Text style={styles.emptySubtext}>
              No work is assigned to you for these days. Pull down to refresh.
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      />

      <ItineraryItemDetail item={selected} onClose={() => setSelected(null)} />
    </SafeAreaView>
  )
}

function StopCard({
  stop,
  onItemPress,
  onTripPress,
}: {
  stop: ItineraryStop
  onItemPress: (item: ItineraryItem) => void
  onTripPress: (tripId: number) => void
}) {
  const { line2 } = placeLines(stop.place)
  const title = stopTitle(stop)
  return (
    <View style={styles.stopCard}>
      <Text style={styles.stopTitle}>{title}</Text>
      {line2 && line2 !== title ? <Text style={styles.stopSubtitle}>{line2}</Text> : null}
      {stop.items.map((item) => (
        <ItemRow
          key={item.key}
          item={item}
          onPress={() => onItemPress(item)}
          onTripPress={onTripPress}
        />
      ))}
    </View>
  )
}

function ItemRow({
  item,
  onPress,
  onTripPress,
}: {
  item: ItineraryItem
  onPress: () => void
  onTripPress: (tripId: number) => void
}) {
  const done = isDone(item)
  const offered = (item.tripStatus ?? '').trim().toLowerCase() === OFFERED_STATUS
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.itemRow, offered && styles.itemRowOffered]}
      accessibilityRole="button"
      accessibilityLabel={`${item.actName}, order ${item.orderNum}${done ? ', done' : ''}`}
      activeOpacity={0.7}
    >
      <View style={styles.itemMain}>
        <Text style={[styles.itemAct, done && styles.itemActDone]}>
          {done ? '✓ ' : ''}
          {item.actName}
        </Text>
        <Text style={styles.itemOrder} numberOfLines={1}>
          #{item.orderNum}
          {item.shipperName ? ` · ${item.shipperName}` : ''}
        </Text>
        {item.arrivalWindow ? (
          <Text style={styles.itemMeta}>Arrive {formatWindow(item.arrivalWindow)}</Text>
        ) : null}
      </View>
      <View style={styles.itemTags}>
        {isLocalItem(item) ? (
          <View style={styles.tag}>
            <Text style={styles.tagText}>Local</Text>
          </View>
        ) : null}
        {item.kind === 'storage' ? (
          <View style={styles.tag}>
            <Text style={styles.tagText}>Storage</Text>
          </View>
        ) : null}
        {item.confirmed && !done ? (
          <View style={[styles.tag, styles.tagConfirmed]}>
            <Text style={[styles.tagText, styles.tagTextLight]}>Confirmed</Text>
          </View>
        ) : null}
        {item.tripId != null ? (
          <TouchableOpacity
            onPress={() => onTripPress(item.tripId as number)}
            accessibilityRole="button"
            accessibilityLabel={`Open trip ${item.tripId}`}
            hitSlop={6}
            style={styles.tripChip}
          >
            <Text style={styles.tripChipText}>Trip {item.tripId}</Text>
            {item.tripStatus ? <TripStatusBadge status={item.tripStatus} /> : null}
          </TouchableOpacity>
        ) : null}
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLight },
  rangeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rangeButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  rangeArrow: { fontSize: fontSize.xxlarge, fontWeight: '700', color: colors.textPrimary },
  rangeLabel: {
    fontSize: fontSize.large,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  rangeHint: { fontSize: fontSize.small, color: colors.textSecondary, textAlign: 'center' },
  partialBanner: {
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  partialText: { fontSize: fontSize.medium, color: colors.textPrimary, fontWeight: '600' },
  listContent: { padding: spacing.md, flexGrow: 1 },
  dayHeader: {
    backgroundColor: colors.backgroundLight,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  dayHeaderText: { fontSize: fontSize.large, fontWeight: '700', color: colors.textPrimary },
  stopCard: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  stopTitle: { fontSize: fontSize.large, fontWeight: '700', color: colors.textPrimary },
  stopSubtitle: { fontSize: fontSize.medium, color: colors.textSecondary, marginTop: -spacing.xs },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  itemRowOffered: {
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    paddingLeft: spacing.sm,
  },
  itemMain: { flex: 1, gap: 2 },
  itemAct: { fontSize: fontSize.large, fontWeight: '600', color: colors.textPrimary },
  itemActDone: { color: colors.success },
  itemOrder: { fontSize: fontSize.medium, color: colors.textSecondary },
  itemMeta: { fontSize: fontSize.medium, color: colors.textPrimary },
  itemTags: { alignItems: 'flex-end', gap: spacing.xs },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.small,
    backgroundColor: colors.backgroundLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagConfirmed: { backgroundColor: colors.success, borderColor: colors.success },
  tagText: { fontSize: fontSize.small, fontWeight: '600', color: colors.textSecondary },
  tagTextLight: { color: colors.textLight },
  tripChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  tripChipText: { fontSize: fontSize.small, fontWeight: '700', color: colors.inTransit },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.backgroundLight,
  },
  centeredText: { marginTop: spacing.md, fontSize: fontSize.large, color: colors.textSecondary },
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
    lineHeight: 22,
  },
  retryButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.medium,
    backgroundColor: colors.primary,
  },
  retryText: { color: colors.textLight, fontWeight: '700', fontSize: fontSize.medium },
})
