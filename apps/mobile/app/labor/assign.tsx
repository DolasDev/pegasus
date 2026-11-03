import React, { useCallback, useRef, useState } from 'react'
import {
  View,
  Text,
  SectionList,
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
// Pick a crew from my list, or from the company's list, for one activity (pushed from the shipment's Labor
// tab). Company crews that aren't in my book come in a second section; a crew
// in both lists appears once, under mine. Picking assigns it and goes back. "New crew" adds one by hand and
// assigns it on the way back; "From contacts" imports into my list, and the
// imported crews appear here on return to be picked.
// ---------------------------------------------------------------------------

export default function AssignCrewScreen() {
  const { activityId, orderNum } = useLocalSearchParams<{ activityId: string; orderNum: string }>()
  const router = useRouter()
  const id = Number(activityId)
  const [query, setQuery] = useState('')
  const q = useDebouncedValue(query, 300)
  const [mine, setMine] = useState<LaborCrew[] | null>(null)
  const [company, setCompany] = useState<LaborCrew[]>([])
  const [assigned, setAssigned] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const requestSeq = useRef(0)

  useFocusEffect(
    useCallback(() => {
      const seq = ++requestSeq.current
      Promise.all([
        LaborService.searchCrews(q),
        LaborService.getOrderActivities(orderNum),
        // The company list is a bonus: if it can't load, my own crews still pick.
        LaborService.searchCompanyCrews(q).catch(() => null),
      ])
        .then(([res, activities, companyRes]) => {
          if (seq !== requestSeq.current) return
          setMine(res.crews)
          setCompany((companyRes?.crews ?? []).filter((c) => !c.inMyList))
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

  // Two sections only when there is a company crew to tell apart from mine.
  const sections = [
    { title: company.length ? 'My crews' : '', data: mine ?? [] },
    ...(company.length ? [{ title: 'Company crews', data: company }] : []),
  ].filter((s) => s.data.length > 0)

  const params = { activityId: String(id), orderNum: String(orderNum) }

  return (
    <View style={styles.container}>
      <View style={styles.actions}>
        <Action label="New crew" onPress={() => router.push({ pathname: '/labor/new', params })} />
        <Action label="From contacts" onPress={() => router.push('/labor/import')} />
      </View>
      <SearchBar value={query} onChangeText={setQuery} placeholder="Search crews" />
      {saving ? <ActivityIndicator style={styles.saving} color={colors.primary} /> : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : !mine ? (
        <ActivityIndicator style={styles.saving} size="large" color={colors.primary} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(c) => c.phone}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          renderSectionHeader={({ section }) =>
            section.title ? <Text style={styles.sectionHeader}>{section.title}</Text> : null
          }
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
  sectionHeader: {
    paddingVertical: spacing.xs,
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textSecondary,
    backgroundColor: colors.backgroundLight,
  },
  assignedTag: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
})
