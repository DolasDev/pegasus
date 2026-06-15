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
import type { DriverMetrics } from '../../src/types'
import { colors, fontSize, spacing } from '../../src/theme/colors'

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export default function DashboardScreen() {
  const [metrics, setMetrics] = useState<DriverMetrics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const router = useRouter()
  const { offeredCount, refresh: refreshTrips } = useTrips()

  const load = useCallback(async () => {
    try {
      const data = await getDriverMetrics()
      setMetrics(data)
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

  if (isLoading || !metrics) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading dashboard…</Text>
      </SafeAreaView>
    )
  }

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
              value={String(metrics.activeShipments)}
              subtitle="Assigned to you"
            />
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          <MetricCard
            label="Account Balance"
            value={currency.format(metrics.accountBalance)}
            subtitle="Available"
            accent={colors.primary}
          />
          <View style={styles.gap} />
          <MetricCard
            label="Completed (wk)"
            value={String(metrics.completedThisWeek)}
            subtitle="This week"
          />
        </View>

        <View style={styles.row}>
          <MetricCard
            label="Pending Settlement"
            value={currency.format(metrics.pendingSettlementTotal)}
            subtitle="Awaiting payout"
            accent={colors.primary}
          />
          <View style={styles.gap} />
          <MetricCard
            label="Miles (wk)"
            value={metrics.milesThisWeek.toLocaleString('en-US')}
            subtitle="This week"
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
  loadingText: {
    marginTop: spacing.md,
    fontSize: fontSize.large,
    color: colors.textSecondary,
  },
})
