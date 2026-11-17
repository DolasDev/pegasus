import React, { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { useActivity } from '../../src/context/ActivityContext'
import { ActivityService } from '../../src/services/activityService'
import { notificationRoute } from '../../src/services/pushNotifications'
import type { ActivityItem } from '../../src/types/activity'
import { groupActivity, rowTitle, shortAge, type ActivityRow } from '../../src/utils/activity'
import { logger } from '../../src/utils/logger'
import { colors, fontSize, spacing, borderRadius } from '../../src/theme/colors'

// ---------------------------------------------------------------------------
// Activity — what happened that concerns you (task queue plan, Phase 2): trip
// and move assignments, @mentions, messages from the office. One row per
// event, grouped by order. Tapping opens the same screen the push would have.
// Opening the screen clears the bell (seen); tapping a row marks it read.
// ---------------------------------------------------------------------------

export default function ActivityScreen() {
  const router = useRouter()
  const { markSeen } = useActivity()
  const [items, setItems] = useState<ActivityItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadFirst = useCallback(async () => {
    try {
      const page = await ActivityService.list()
      setItems(page.items)
      setCursor(page.nextCursor)
      setError(null)
    } catch (err) {
      logger.warn('Failed to load Activity', err)
      setError(err instanceof Error ? err.message : 'Failed to load Activity')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void loadFirst()
      void markSeen()
    }, [loadFirst, markSeen]),
  )

  const onRefresh = async () => {
    setRefreshing(true)
    await loadFirst()
    setRefreshing(false)
  }

  const loadMore = async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await ActivityService.list({ cursor })
      setItems((prev) => [...prev, ...page.items])
      setCursor(page.nextCursor)
    } catch (err) {
      logger.warn('Failed to load more Activity', err)
    } finally {
      setLoadingMore(false)
    }
  }

  const markRead = (ids: string[]) => {
    const now = new Date().toISOString()
    setItems((prev) =>
      prev.map((i) => (ids.includes(i.id) && !i.readAt ? { ...i, readAt: now } : i)),
    )
    for (const id of ids) {
      ActivityService.markRead(id).catch((err) => logger.warn('Failed to mark read', err))
    }
  }

  const open = (row: ActivityRow) => {
    markRead(row.items.filter((i) => !i.readAt).map((i) => i.id))
    const path = notificationRoute(row.lead.data)
    if (path) router.push(path)
  }

  const readAll = async () => {
    const now = new Date().toISOString()
    setItems((prev) => prev.map((i) => (i.readAt ? i : { ...i, readAt: now })))
    try {
      await ActivityService.markAllRead()
    } catch (err) {
      logger.warn('Failed to mark all read', err)
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom', 'left', 'right']}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    )
  }

  if (error && items.length === 0) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom', 'left', 'right']}>
        <Text style={styles.emptyTitle}>Couldn’t load Activity</Text>
        <Text style={styles.emptySubtext}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => void loadFirst()}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  const rows = groupActivity(items)
  const anyUnread = rows.some((r) => r.unread)

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <View style={styles.toolbar}>
        <TouchableOpacity
          onPress={() => router.push('/notification-settings')}
          accessibilityRole="button"
          accessibilityLabel="Notification settings"
        >
          <Text style={styles.toolbarText}>Settings</Text>
        </TouchableOpacity>
        {anyUnread ? (
          <TouchableOpacity
            onPress={() => void readAll()}
            accessibilityRole="button"
            accessibilityLabel="Mark all read"
          >
            <Text style={styles.toolbarText}>Mark all read</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={({ item: row }) => (
          <TouchableOpacity
            style={[styles.row, row.unread && styles.rowUnread]}
            onPress={() => open(row)}
            accessibilityRole="button"
            accessibilityLabel={rowTitle(row)}
            testID={`activity-${row.key}`}
          >
            {row.unread ? <View style={styles.dot} /> : <View style={styles.dotSpacer} />}
            <View style={styles.rowText}>
              <Text style={[styles.title, row.unread && styles.titleUnread]} numberOfLines={1}>
                {rowTitle(row)}
              </Text>
              <Text style={styles.body} numberOfLines={2}>
                {row.items.length > 1 ? row.lead.title : row.lead.body}
              </Text>
              {row.lead.actorName ? <Text style={styles.meta}>{row.lead.actorName}</Text> : null}
            </View>
            <Text style={styles.age}>{shortAge(row.lead.createdAt)}</Text>
          </TouchableOpacity>
        )}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={styles.footer} color={colors.primary} /> : null
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>No activity yet</Text>
            <Text style={styles.emptySubtext}>
              Assignments, @mentions and messages from the office show up here.
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLight },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.backgroundLight,
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
  retryText: { color: colors.textLight, fontWeight: '700', fontSize: fontSize.medium },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toolbarText: { fontSize: fontSize.medium, fontWeight: '600', color: colors.primary },
  listContent: { flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowUnread: { backgroundColor: colors.backgroundLight },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6, backgroundColor: colors.primary },
  dotSpacer: { width: 10 },
  rowText: { flex: 1 },
  title: { fontSize: fontSize.medium, color: colors.textPrimary },
  titleUnread: { fontWeight: '700' },
  body: { fontSize: fontSize.small, color: colors.textSecondary, marginTop: 2 },
  meta: { fontSize: fontSize.small, color: colors.textSecondary, marginTop: 2 },
  age: { fontSize: fontSize.small, color: colors.textSecondary },
  footer: { padding: spacing.md },
})
