import React, { useMemo, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { TripCard } from '../../src/components/TripCard'
import { useTrips } from '../../src/context/TripsContext'
import { OFFERED_STATUS } from '../../src/services/tripService'
import { colors, fontSize, spacing, borderRadius } from '../../src/theme/colors'

const ALL = '__all__'

export default function TripsScreen() {
  const { trips, loading, mappingResolved, driverId, error, refresh } = useTrips()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selected, setSelected] = useState<string>(ALL)
  const router = useRouter()

  // Distinct status names present, in a stable order, for the filter chips.
  const statuses = useMemo(() => {
    const seen = new Map<string, string>()
    for (const t of trips) {
      const label = (t.status_status ?? '').trim()
      if (label) seen.set(label.toLowerCase(), label)
    }
    return Array.from(seen.values())
  }, [trips])

  const filtered = useMemo(() => {
    if (selected === ALL) return trips
    return trips.filter((t) => (t.status_status ?? '').trim().toLowerCase() === selected)
  }, [trips, selected])

  const offeredCount = useMemo(
    () =>
      trips.filter((t) => (t.status_status ?? '').trim().toLowerCase() === OFFERED_STATUS).length,
    [trips],
  )

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await refresh()
    setIsRefreshing(false)
  }

  if (loading && !isRefreshing) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom', 'left', 'right']}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.centeredText}>Loading your trips…</Text>
      </SafeAreaView>
    )
  }

  // The mapping lookup itself failed (network/client error) — this is NOT the
  // same as "resolved, and you have no driver". Surface it as an error so a
  // broken request isn't misreported as an onboarding state.
  if (error && driverId == null) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom', 'left', 'right']}>
        <Text style={styles.emptyTitle}>Couldn’t load your driver</Text>
        <Text style={styles.emptySubtext}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => void handleRefresh()}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  // Mapping resolved successfully but no driver linked → onboarding empty state.
  if (mappingResolved && driverId == null) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom', 'left', 'right']}>
        <Text style={styles.emptyTitle}>No driver linked</Text>
        <Text style={styles.emptySubtext}>
          Your account isn’t linked to a driver yet. Ask your dispatcher to map your login to a
          driver, then pull to refresh.
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => void handleRefresh()}>
          <Text style={styles.retryText}>Refresh</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      {statuses.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Chip label="All" active={selected === ALL} onPress={() => setSelected(ALL)} />
          {statuses.map((label) => {
            const key = label.toLowerCase()
            const isOffered = key === OFFERED_STATUS
            return (
              <Chip
                key={key}
                label={isOffered && offeredCount > 0 ? `${label} (${offeredCount})` : label}
                active={selected === key}
                highlight={isOffered && offeredCount > 0}
                onPress={() => setSelected(key)}
              />
            )
          })}
        </ScrollView>
      )}

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <TripCard trip={item} onPress={() => router.push(`/trip/${item.id}`)} />
        )}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>{error ? 'Couldn’t load trips' : 'No trips'}</Text>
            <Text style={styles.emptySubtext}>
              {error ?? 'You have no assigned trips in this view. Pull down to refresh.'}
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
    </SafeAreaView>
  )
}

function Chip({
  label,
  active,
  highlight,
  onPress,
}: {
  label: string
  active: boolean
  highlight?: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.chip,
        active && styles.chipActive,
        highlight && !active && styles.chipHighlight,
      ]}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  chips: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipHighlight: {
    borderColor: colors.warning,
  },
  chipText: {
    fontSize: fontSize.medium,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  chipTextActive: {
    color: colors.textLight,
  },
  listContent: {
    padding: spacing.md,
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.backgroundLight,
  },
  centeredText: {
    marginTop: spacing.md,
    fontSize: fontSize.large,
    color: colors.textSecondary,
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
    lineHeight: 22,
  },
  retryButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.medium,
    backgroundColor: colors.primary,
  },
  retryText: {
    color: colors.textLight,
    fontWeight: '700',
    fontSize: fontSize.medium,
  },
})
