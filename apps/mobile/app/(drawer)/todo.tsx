import React, { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { AddDocumentModal } from '../../src/components/AddDocumentModal'
import { BlockTaskModal } from '../../src/components/BlockTaskModal'
import { useTasks } from '../../src/context/TasksContext'
import { ItineraryService } from '../../src/services/itineraryService'
import { TaskService, snoozeUntilTomorrow } from '../../src/services/taskService'
import type { DriverTask } from '../../src/types/tasks'
import { formatDay, localDay } from '../../src/utils/itinerary'
import { groupTasks, type TaskOrderGroup } from '../../src/utils/tasks'
import { logger } from '../../src/utils/logger'
import { colors, fontSize, spacing, borderRadius } from '../../src/theme/colors'

// ---------------------------------------------------------------------------
// To Do — the driver's open tasks, computed by the API from their itinerary
// and the order documents (task queue plan, Phase 1). A task clears itself
// when its data arrives: "Mark done" posts the same DONE fact the itinerary's
// button does, and "Upload" opens the document modal with the type preset.
// "Later" snoozes until 6 am tomorrow. "Can't do it" blocks the task with a
// reason and tells operations (andon); a blocked task stays on the list, marked,
// until it's done or unblocked.
// ---------------------------------------------------------------------------

type Upload = { orderNum: number; documentType: string }

export default function TodoScreen() {
  const { tasks, meta, loading, error, enabled, refresh } = useTasks()
  const router = useRouter()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [upload, setUpload] = useState<Upload | null>(null)
  const [blocking, setBlocking] = useState<DriverTask | null>(null)
  const [blockBusy, setBlockBusy] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // One read per visit to the screen (plus pull-to-refresh), never on a timer.
  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await refresh()
    setIsRefreshing(false)
  }

  const act = async (task: DriverTask, run: () => Promise<unknown>, failure: string) => {
    setBusyKey(task.key)
    try {
      await run()
      await refresh()
    } catch (err) {
      logger.warn(failure, err)
      Alert.alert(failure, err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setBusyKey(null)
    }
  }

  const doTask = (task: DriverTask) => {
    const target = task.target
    if (target.kind === 'upload-document') {
      setUpload({ orderNum: target.orderNum, documentType: target.documentType })
      return
    }
    void act(
      task,
      () => ItineraryService.setDone({ key: target.itemKey, day: target.day }, localDay()),
      'Couldn’t mark it done',
    )
  }

  const snooze = (task: DriverTask) =>
    void act(task, () => TaskService.snooze(task.key, snoozeUntilTomorrow()), 'Couldn’t snooze it')

  const unblock = (task: DriverTask) =>
    void act(task, () => TaskService.unblock(task.key), 'Couldn’t unblock it')

  const submitBlock = async (reason: string) => {
    if (!blocking) return
    setBlockBusy(true)
    try {
      const { notified } = await TaskService.block(blocking.key, reason, localDay())
      setBlocking(null)
      if (notified === 0 && !blocking.blocked) {
        Alert.alert(
          'Nobody was notified',
          'No one at your company has an operations role in Pegasus. Call the office.',
        )
      }
      await refresh()
    } catch (err) {
      logger.warn('Failed to block a task', err)
      Alert.alert('Couldn’t send it', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setBlockBusy(false)
    }
  }

  if (loading && !isRefreshing && !meta) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom', 'left', 'right']}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.centeredText}>Loading your To Do…</Text>
      </SafeAreaView>
    )
  }

  if (error && !meta) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom', 'left', 'right']}>
        <Text style={styles.emptyTitle}>Couldn’t load your To Do</Text>
        <Text style={styles.emptySubtext}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => void refresh()}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  if (meta && !enabled) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom', 'left', 'right']}>
        <Text style={styles.emptyTitle}>To Do is off</Text>
        <Text style={styles.emptySubtext}>Your company hasn’t turned on driver tasks yet.</Text>
      </SafeAreaView>
    )
  }

  const partial = (meta?.failedSources.length ?? 0) + (meta?.unavailable.length ?? 0) > 0
  const sections = groupTasks(tasks).map((s) => ({ ...s, data: s.orders }))

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      {partial ? (
        <View style={styles.partialBanner} accessibilityRole="alert">
          <Text style={styles.partialText}>
            Some of your work couldn’t be loaded, so this list may be missing tasks. Pull to
            refresh.
          </Text>
        </View>
      ) : null}
      <SectionList
        sections={sections}
        keyExtractor={(g) => `${g.orderNum}`}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text
              style={[styles.sectionHeaderText, section.bucket === 'overdue' && styles.overdue]}
            >
              {section.title}
            </Text>
          </View>
        )}
        renderItem={({ item: group }) => (
          <OrderCard
            group={group}
            busyKey={busyKey}
            onOpenOrder={() => router.push(`/shipment/${group.orderNum}`)}
            onDo={doTask}
            onSnooze={snooze}
            onBlock={setBlocking}
            onUnblock={unblock}
          />
        )}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>All caught up</Text>
            <Text style={styles.emptySubtext}>
              {meta && meta.hidden > 0
                ? `Nothing to do now (${meta.hidden} snoozed).`
                : 'Nothing to do right now. Pull down to refresh.'}
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
      <BlockTaskModal
        task={blocking}
        busy={blockBusy}
        onClose={() => setBlocking(null)}
        onSubmit={(reason) => void submitBlock(reason)}
      />
      <AddDocumentModal
        visible={upload !== null}
        orderNum={upload?.orderNum ?? ''}
        initialType={upload?.documentType}
        onClose={() => setUpload(null)}
        onUploaded={() => {
          setUpload(null)
          void refresh()
        }}
      />
    </SafeAreaView>
  )
}

function OrderCard({
  group,
  busyKey,
  onOpenOrder,
  onDo,
  onSnooze,
  onBlock,
  onUnblock,
}: {
  group: TaskOrderGroup
  busyKey: string | null
  onOpenOrder: () => void
  onDo: (t: DriverTask) => void
  onSnooze: (t: DriverTask) => void
  onBlock: (t: DriverTask) => void
  onUnblock: (t: DriverTask) => void
}) {
  return (
    <View style={styles.card}>
      <TouchableOpacity
        onPress={onOpenOrder}
        accessibilityRole="button"
        accessibilityLabel={`Open order ${group.orderNum}`}
      >
        <Text style={styles.cardTitle}>
          {group.shipperName ?? 'Order'} · #{group.orderNum}
        </Text>
      </TouchableOpacity>
      {group.tasks.map((t) => {
        const busy = busyKey === t.key
        return (
          <View key={t.key} style={styles.taskRow} testID={`task-${t.key}`}>
            <View style={styles.taskText}>
              <Text style={styles.taskTitle}>{t.title}</Text>
              <Text style={styles.taskDue}>{formatDay(t.due)}</Text>
              {t.blocked ? <Text style={styles.blocked}>Blocked: {t.blocked.reason}</Text> : null}
              <TouchableOpacity
                onPress={() => (t.blocked ? onUnblock(t) : onBlock(t))}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`${t.blocked ? 'Unblock' : 'Can’t do it'}: ${t.title}, order ${t.orderNum}`}
              >
                <Text style={styles.link}>{t.blocked ? 'Unblock' : 'Can’t do it'}</Text>
              </TouchableOpacity>
            </View>
            {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
            <TouchableOpacity
              onPress={() => onSnooze(t)}
              disabled={busy}
              style={styles.secondaryButton}
              accessibilityRole="button"
              accessibilityLabel={`Later: ${t.title}, order ${t.orderNum}`}
            >
              <Text style={styles.secondaryText}>Later</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onDo(t)}
              disabled={busy}
              style={styles.primaryButton}
              accessibilityRole="button"
              accessibilityLabel={`${t.title}, order ${t.orderNum}`}
            >
              <Text style={styles.primaryText}>
                {t.target.kind === 'mark-done' ? 'Mark done' : 'Upload'}
              </Text>
            </TouchableOpacity>
          </View>
        )
      })}
    </View>
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
  partialBanner: {
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  partialText: { fontSize: fontSize.medium, color: colors.textPrimary, fontWeight: '600' },
  listContent: { padding: spacing.md, flexGrow: 1 },
  sectionHeader: {
    backgroundColor: colors.backgroundLight,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  sectionHeaderText: { fontSize: fontSize.large, fontWeight: '700', color: colors.textPrimary },
  overdue: { color: colors.error },
  card: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  cardTitle: { fontSize: fontSize.large, fontWeight: '700', color: colors.textPrimary },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  taskText: { flex: 1 },
  taskTitle: { fontSize: fontSize.medium, fontWeight: '600', color: colors.textPrimary },
  taskDue: { fontSize: fontSize.small, color: colors.textSecondary },
  blocked: { fontSize: fontSize.small, fontWeight: '700', color: colors.error },
  link: { fontSize: fontSize.small, color: colors.primary, marginTop: 2 },
  primaryButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.medium,
    backgroundColor: colors.primary,
  },
  primaryText: { fontSize: fontSize.medium, fontWeight: '700', color: colors.textLight },
  secondaryButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { fontSize: fontSize.medium, fontWeight: '600', color: colors.textPrimary },
})
