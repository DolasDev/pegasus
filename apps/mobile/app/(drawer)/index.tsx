import React, { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { MetricCard } from '../../src/components/MetricCard'
import { getDriverMetrics } from '../../src/services/driverMetrics'
import { useTrips } from '../../src/context/TripsContext'
import { logger } from '../../src/utils/logger'
import type { DriverMetrics } from '../../src/types'
import { colors, fontSize, spacing } from '../../src/theme/colors'

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const UNAVAILABLE = 'Unavailable'
const DASH = '—'

type LoadError = 'not_linked' | 'failed'

function money(value: number | null | undefined): string {
  return value == null ? DASH : currency.format(value)
}

export default function DashboardScreen() {
  const [metrics, setMetrics] = useState<DriverMetrics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<LoadError | null>(null)
  const router = useRouter()
  const { offeredCount, refresh: refreshTrips } = useTrips()

  const load = useCallback(async () => {
    try {
      const result = await getDriverMetrics()
      if (result.status === 'not_linked') {
        setMetrics(null)
        setError('not_linked')
      } else {
        setMetrics(result.metrics)
        setError(null)
      }
    } catch (err) {
      logger.error('Failed to load driver metrics', err)
      setError('failed')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const onRefresh = () => {
    setIsRefreshing(true)
    void refreshTrips()
    load()
  }

  const retry = () => {
    setError(null)
    setIsLoading(true)
    void load()
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading dashboard…</Text>
      </SafeAreaView>
    )
  }

  if (error || !metrics) {
    return (
      <SafeAreaView style={styles.loading}>
        <Text style={styles.errorText}>
          {error === 'not_linked'
            ? "Your account isn't linked to a driver yet — ask your dispatcher."
            : "We couldn't load your dashboard."}
        </Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={retry}
          accessibilityRole="button"
          accessibilityLabel="Retry"
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  const { trips, financials } = metrics
  const monthEnd = financials?.monthEnd ?? null
  const balanceLines: string[] = []
  if (financials?.escrowHeld != null)
    balanceLines.push(`Escrow held ${money(financials.escrowHeld)}`)
  if (monthEnd) {
    balanceLines.push(
      `Month-end ${MONTHS[monthEnd.month - 1] ?? monthEnd.month} ${monthEnd.year} ${money(monthEnd.balance)}`,
    )
  }
  const balanceKnown = financials?.runningBalance != null

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <Text style={styles.sectionTitle}>TODAY AT A GLANCE</Text>

        <View style={styles.row}>
          <TouchableOpacity
            style={styles.tappable}
            activeOpacity={0.7}
            onPress={() => router.push('/trips')}
            accessibilityRole="button"
            accessibilityLabel={`Offered trips: ${offeredCount}. Open My Trips.`}
          >
            <MetricCard
              label="Offered Trips"
              value={String(offeredCount)}
              subtitle={offeredCount > 0 ? 'Tap to review' : 'None queued'}
              accent={offeredCount > 0 ? colors.warning : undefined}
            />
          </TouchableOpacity>
          <View style={styles.gap} />
          <TouchableOpacity
            style={styles.tappable}
            activeOpacity={0.7}
            onPress={() => router.push('/trips')}
            accessibilityRole="button"
            accessibilityLabel="Open My Trips"
          >
            <MetricCard
              label="Active Shipments"
              value={trips ? String(trips.activeShipments) : DASH}
              subtitle={trips ? 'Assigned to you' : UNAVAILABLE}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          <MetricCard
            label="Account Balance"
            value={money(financials?.runningBalance)}
            subtitle={balanceKnown ? undefined : UNAVAILABLE}
            subtitleLines={balanceLines}
            accent={colors.primary}
          />
          <View style={styles.gap} />
          <MetricCard
            label="Completed (wk)"
            value={trips ? String(trips.completedThisWeek) : DASH}
            subtitle={trips ? 'This week' : UNAVAILABLE}
          />
        </View>

        <View style={styles.row}>
          <MetricCard
            label="Pending Settlement"
            value={money(financials?.pendingSettlement.total)}
            subtitle={
              financials ? `${financials.pendingSettlement.count} awaiting payout` : UNAVAILABLE
            }
            accent={colors.primary}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  content: {
    padding: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  gap: {
    width: spacing.md,
  },
  tappable: {
    flex: 1,
  },
  filler: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundLight,
  },
  errorText: {
    fontSize: fontSize.large,
    color: colors.textPrimary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  retryButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  retryText: {
    color: colors.background,
    fontWeight: '700',
    fontSize: fontSize.large,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: fontSize.large,
    color: colors.textSecondary,
  },
})
