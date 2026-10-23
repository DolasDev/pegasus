import React, { useCallback, useRef, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { SearchBar } from '../../src/components/SearchBar'
import { CrewCard } from '../../src/components/CrewCard'
import { LaborService, withCrew } from '../../src/services/laborService'
import { useDebouncedValue } from '../../src/utils/useDebouncedValue'
import type { LaborCrew } from '../../src/types/labor'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../../src/theme/colors'

// ---------------------------------------------------------------------------
// Pick a crew from my list for one activity (pushed from the shipment's Labor
// tab). Picking assigns it and goes back. "New crew" adds one by hand and
// assigns it on the way back; "From contacts" imports into my list, and the
// imported crews appear here on return to be picked.
// ---------------------------------------------------------------------------

export default function AssignCrewScreen() {
  const { activityId, orderNum } = useLocalSearchParams<{ activityId: string; orderNum: string }>()
  const router = useRouter()
  const id = Number(activityId)
  const [query, setQuery] = useState('')
  const q = useDebouncedValue(query, 300)
  const [crews, setCrews] = useState<LaborCrew[] | null>(null)
  const [assigned, setAssigned] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const requestSeq = useRef(0)

  useFocusEffect(
    useCallback(() => {
      const seq = ++requestSeq.current
      Promise.all([LaborService.searchCrews(q), LaborService.getOrderActivities(orderNum)])
        .then(([res, activities]) => {
          if (seq !== requestSeq.current) return
          setCrews(res.crews)
          const activity = activities.find((a) => a.id === id)
          setAssigned(new Set(activity?.crews.map((c) => c.phone) ?? []))
          setError(null)
        })
        .catch((err) => {
          if (seq === requestSeq.current) {
            setError(err instanceof Error ? err.message : 'Failed to load crews')
          }
        })
    }, [q, orderNum, id]),
  )

  const pick = async (crew: LaborCrew) => {
    if (assigned.has(crew.phone)) {
      router.back()
      return
    }
    setSaving(true)
    try {
      await LaborService.updateActivityLabor(orderNum, id, (set) => withCrew(set, crew.phone))
      router.back()
    } catch (err) {
      Alert.alert('Couldn’t assign crew', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const params = { activityId: String(id), orderNum: String(orderNum) }

  return (
    <View style={styles.container}>
      <View style={styles.actions}>
        <Action label="New crew" onPress={() => router.push({ pathname: '/labor/new', params })} />
        <Action label="From contacts" onPress={() => router.push('/labor/import')} />
      </View>
      <SearchBar value={query} onChangeText={setQuery} placeholder="Search my crews" />
      {saving ? <ActivityIndicator style={styles.saving} color={colors.primary} /> : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : !crews ? (
        <ActivityIndicator style={styles.saving} size="large" color={colors.primary} />
      ) : (
        <FlatList
          data={crews}
          keyExtractor={(c) => c.phone}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {q.trim() ? 'No crews match.' : 'Your list is empty — add a crew above.'}
            </Text>
          }
          renderItem={({ item }) => (
            <View>
              {assigned.has(item.phone) ? (
                <Text style={styles.assignedTag}>Already on this activity</Text>
              ) : null}
              <CrewCard crew={item} onPress={() => !saving && void pick(item)} />
            </View>
          )}
        />
      )}
    </View>
  )
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.action} onPress={onPress} accessibilityRole="button">
      <Text style={styles.actionText}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLight },
  actions: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, paddingBottom: 0 },
  action: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    borderRadius: borderRadius.medium,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { fontSize: fontSize.medium, fontWeight: '700', color: colors.textLight },
  list: { padding: spacing.md },
  saving: { marginTop: spacing.md },
  error: { fontSize: fontSize.medium, color: colors.error, padding: spacing.md },
  empty: {
    fontSize: fontSize.medium,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  assignedTag: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
})
