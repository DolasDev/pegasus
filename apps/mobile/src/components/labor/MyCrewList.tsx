import React, { useCallback, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Switch,
  Alert,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { LaborService } from '../../services/laborService'
import { logger } from '../../utils/logger'
import type { MyCrewMember } from '../../types/labor'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../../theme/colors'

// ---------------------------------------------------------------------------
// My crew — the Labor screen's third segment: the driver's own packers, private
// to them. Each row's "Every job" switch saves at once; a flagged member is put
// on the driver's pack, load and delivery jobs whenever dispatch accepts one of
// their trips. Tapping a row opens the member form (app/labor/packer, myCrew=1),
// which also removes them.
// ---------------------------------------------------------------------------

const errText = (err: unknown) => (err instanceof Error ? err.message : 'Please try again.')

export function MyCrewList() {
  const router = useRouter()
  const [members, setMembers] = useState<MyCrewMember[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setMembers(await LaborService.getMyCrew())
      setError(null)
    } catch (err) {
      logger.warn('Failed to load my crew', err)
      setError(errText(err))
    }
  }, [])

  // A member added, edited or removed on the pushed form shows up on return.
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const handleRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const setEveryJob = async (member: MyCrewMember, everyJob: boolean) => {
    setSavingId(member.id)
    setMembers((list) => list?.map((m) => (m.id === member.id ? { ...m, everyJob } : m)) ?? null)
    try {
      const saved = await LaborService.updateMyCrewMember(member.id, { everyJob })
      setMembers((list) => list?.map((m) => (m.id === saved.id ? saved : m)) ?? null)
    } catch (err) {
      setMembers((list) => list?.map((m) => (m.id === member.id ? member : m)) ?? null)
      Alert.alert('Couldn’t save', errText(err))
    } finally {
      setSavingId(null)
    }
  }

  const add = () => router.push({ pathname: '/labor/packer', params: { myCrew: '1' } })
  const open = (m: MyCrewMember) =>
    router.push({ pathname: '/labor/packer', params: { myCrew: '1', id: m.id } })

  if (members === null && !error) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    )
  }

  const header = (
    <View style={styles.header}>
      <Text style={styles.hint}>
        Turn on Every job and they’re added to your pack, load and delivery jobs when a trip is
        accepted.
      </Text>
      <TouchableOpacity style={styles.addButton} onPress={add} accessibilityRole="button">
        <Text style={styles.addButtonText}>+ Add to my crew</Text>
      </TouchableOpacity>
    </View>
  )

  const empty = (
    <View style={styles.centered}>
      {error ? (
        <>
          <Text style={styles.emptyTitle}>Couldn’t load your crew</Text>
          <Text style={styles.emptySubtext}>{error}</Text>
          <TouchableOpacity style={styles.retry} onPress={() => void load()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.emptyTitle}>No one in your crew yet</Text>
          <Text style={styles.emptySubtext}>
            Add the packers who work with you. Only you can see them.
          </Text>
        </>
      )}
    </View>
  )

  return (
    <FlatList
      data={members ?? []}
      keyExtractor={(m) => m.id}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void handleRefresh()}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
      renderItem={({ item }) => {
        const detail = [item.phoneDisplay, item.cidNumber ? `CID ${item.cidNumber}` : null]
          .filter(Boolean)
          .join(' · ')
        const name = `${item.firstName} ${item.lastName}`
        return (
          <View style={styles.row}>
            <TouchableOpacity
              style={styles.rowMain}
              onPress={() => open(item)}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${name}`}
            >
              <Text style={styles.name}>{name}</Text>
              {detail ? <Text style={styles.detail}>{detail}</Text> : null}
            </TouchableOpacity>
            <View style={styles.toggle}>
              <Text style={styles.toggleLabel}>Every job</Text>
              <Switch
                value={item.everyJob}
                disabled={savingId != null}
                onValueChange={(on) => void setEveryJob(item, on)}
                accessibilityLabel={`Every job: ${name}`}
                trackColor={{ true: colors.brand, false: colors.border }}
              />
            </View>
          </View>
        )
      }}
    />
  )
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, flexGrow: 1 },
  header: { gap: spacing.sm, marginBottom: spacing.sm },
  hint: { fontSize: fontSize.small, color: colors.textSecondary },
  addButton: {
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.medium,
    backgroundColor: colors.brand,
  },
  addButtonText: { fontSize: fontSize.medium, fontWeight: '700', color: colors.textLight },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  rowMain: { flex: 1, minHeight: touchTarget.minHeight, justifyContent: 'center' },
  name: { fontSize: fontSize.medium, fontWeight: '700', color: colors.textPrimary },
  detail: { fontSize: fontSize.small, color: colors.textSecondary, marginTop: 2 },
  toggle: { alignItems: 'center', marginLeft: spacing.sm },
  toggleLabel: { fontSize: fontSize.small, color: colors.textSecondary, marginBottom: 2 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
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
  retry: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.medium,
    backgroundColor: colors.brand,
  },
  retryText: { color: colors.textLight, fontWeight: '700', fontSize: fontSize.medium },
})
