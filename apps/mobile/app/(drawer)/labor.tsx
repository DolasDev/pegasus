import React, { useCallback, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  SectionList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { SearchBar } from '../../src/components/SearchBar'
import { CrewCard } from '../../src/components/CrewCard'
import { MyCrewList } from '../../src/components/labor/MyCrewList'
import { LaborService } from '../../src/services/laborService'
import { useLaborAccess } from '../../src/auth/laborAccess'
import { exportLaborList, type LaborExportFormat } from '../../src/services/laborExport'
import { useDebouncedValue } from '../../src/utils/useDebouncedValue'
import { logger } from '../../src/utils/logger'
import type { LaborCrew, LaborSearchResult } from '../../src/types/labor'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../../src/theme/colors'

// ---------------------------------------------------------------------------
// Labor — the driver's private book of cash-labor crews, the company's shared
// list, and My crew (the driver's own packers — src/components/labor/MyCrewList).
// A driver switches between them with My list | Company | My crew; an
// Operations user who is not a driver sees only Company, where they alone can
// create a crew. Import and Export are for my own list.
//
// No search: every crew A–Z, sectioned by initial like the phone's contacts
// app. A ZIP / postal code / "City, ST" / city name: nearest first, with the
// distance on each card. A state or province: the crews serving it.
// ---------------------------------------------------------------------------

type Scope = 'mine' | 'company' | 'crew'

const EMPTY: LaborSearchResult = { crews: [], location: null, locationNotFound: false }

/** A–Z sections; anything not starting with a letter goes under "#". */
export function sectionsByInitial(crews: readonly LaborCrew[]) {
  const groups = new Map<string, LaborCrew[]>()
  for (const crew of crews) {
    const first = crew.displayName.normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase()
    const key = /[A-Z]/.test(first) ? first : '#'
    groups.set(key, [...(groups.get(key) ?? []), crew])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))
    .map(([title, data]) => ({ title, data }))
}

export default function LaborScreen() {
  const router = useRouter()
  const { isDriver, isOperations, operationsOnly } = useLaborAccess()
  const [picked, setPicked] = useState<Scope | null>(null)
  // An Operations user without a driver identity has no book of their own.
  const scope: Scope = operationsOnly ? 'company' : (picked ?? 'mine')
  const isCompany = scope === 'company'
  const isCrew = scope === 'crew'
  const showSegments = isDriver
  const [query, setQuery] = useState('')
  const q = useDebouncedValue(query, 300)
  const [result, setResult] = useState<LaborSearchResult>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Only the latest request may land — a slow earlier search must not
  // overwrite the results of the one typed after it.
  const requestSeq = useRef(0)

  const load = useCallback(async (search: string, which: Scope) => {
    // My crew loads itself (MyCrewList).
    if (which === 'crew') return
    const seq = ++requestSeq.current
    setError(null)
    try {
      const res =
        which === 'company'
          ? await LaborService.searchCompanyCrews(search)
          : await LaborService.searchCrews(search)
      if (seq === requestSeq.current) setResult(res)
    } catch (err) {
      logger.warn('Failed to load labor crews', err)
      if (seq === requestSeq.current) {
        setError(err instanceof Error ? err.message : 'Failed to load crews')
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [])

  // Runs on focus AND whenever the (debounced) search changes while focused —
  // so a crew added, edited or removed on a pushed screen shows up on return.
  useFocusEffect(
    useCallback(() => {
      void load(q, scope)
    }, [load, q, scope]),
  )

  const handleRefresh = async () => {
    setRefreshing(true)
    await load(q, scope)
    setRefreshing(false)
  }

  const switchScope = (next: Scope) => {
    if (next === scope) return
    // Don't show one list's crews under the other's heading while it loads.
    setResult(EMPTY)
    setLoading(true)
    setPicked(next)
  }

  const runExport = async (format: LaborExportFormat) => {
    setExporting(true)
    try {
      await exportLaborList(format)
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setExporting(false)
    }
  }

  const onAddCrew = () => {
    if (isCompany) {
      router.push({ pathname: '/labor/new', params: { scope: 'company' } })
      return
    }
    Alert.alert('Add crew', undefined, [
      { text: 'From contacts', onPress: () => router.push('/labor/import') },
      { text: 'Enter manually', onPress: () => router.push('/labor/new') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  const onExport = () =>
    Alert.alert(
      'Export Labor list',
      'A contacts file imports straight into your phone’s Contacts. The spreadsheet is in Google Contacts format.',
      [
        { text: 'Contacts file (.vcf)', onPress: () => void runExport('vcf') },
        { text: 'Spreadsheet (.csv)', onPress: () => void runExport('csv') },
        { text: 'Cancel', style: 'cancel' },
      ],
    )

  const openCrew = (crew: LaborCrew) =>
    router.push({ pathname: '/labor/[phone]', params: { phone: crew.phone } })

  const sections = useMemo(() => sectionsByInitial(result.crews), [result.crews])
  const isLocation = result.location !== null
  const searching = q.trim() !== ''

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => void handleRefresh()}
      tintColor={colors.primary}
      colors={[colors.primary]}
    />
  )

  const empty = (
    <View style={styles.centered}>
      {error ? (
        <>
          <Text style={styles.emptyTitle}>Couldn’t load crews</Text>
          <Text style={styles.emptySubtext}>{error}</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => void load(q, scope)}>
            <Text style={styles.primaryButtonText}>Retry</Text>
          </TouchableOpacity>
        </>
      ) : result.locationNotFound ? (
        <>
          <Text style={styles.emptyTitle}>Location not found</Text>
          <Text style={styles.emptySubtext}>
            Try a 5-digit ZIP, a Canadian postal code, or “City, ST”.
          </Text>
        </>
      ) : searching ? (
        <>
          <Text style={styles.emptyTitle}>No matching crews</Text>
          <Text style={styles.emptySubtext}>Search by ZIP, city, state, name or phone.</Text>
        </>
      ) : (
        <>
          <Text style={styles.emptyTitle}>
            {isCompany ? 'No company crews yet' : 'No crews yet'}
          </Text>
          <Text style={styles.emptySubtext}>
            {isCompany
              ? isOperations
                ? 'Add the crews your whole company uses, or share one from a driver’s list.'
                : 'Open a crew in your list and choose Add to company list to share it here.'
              : 'Add the labor crews you hire — import them from your contacts or enter one by hand.'}
          </Text>
          {!isCompany || isOperations ? (
            <TouchableOpacity style={styles.primaryButton} onPress={onAddCrew}>
              <Text style={styles.primaryButtonText}>Add Crew</Text>
            </TouchableOpacity>
          ) : null}
        </>
      )}
    </View>
  )

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <View style={styles.top}>
        {showSegments ? (
          <View style={styles.segments} accessibilityRole="tablist">
            <Segment label="My list" on={scope === 'mine'} onPress={() => switchScope('mine')} />
            <Segment label="Company" on={isCompany} onPress={() => switchScope('company')} />
            <Segment label="My crew" on={isCrew} onPress={() => switchScope('crew')} />
          </View>
        ) : null}
        {isCrew ? null : (
          <>
            <SearchBar
              value={query}
              onChangeText={setQuery}
              placeholder="ZIP, city, state, name or phone"
            />
            {!isCompany || isOperations ? (
              <View style={styles.actions}>
                <TouchableOpacity style={[styles.action, styles.actionPrimary]} onPress={onAddCrew}>
                  <Text style={[styles.actionText, styles.actionPrimaryText]}>+ Add Crew</Text>
                </TouchableOpacity>
                {isCompany ? null : (
                  <TouchableOpacity
                    style={styles.action}
                    onPress={onExport}
                    disabled={exporting}
                    accessibilityState={{ disabled: exporting }}
                  >
                    {exporting ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : (
                      <Text style={styles.actionText}>Export</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            ) : null}
            {isLocation ? (
              <Text style={styles.locationLabel}>Nearest to {result.location!.label}</Text>
            ) : null}
          </>
        )}
      </View>

      {isCrew ? (
        <MyCrewList />
      ) : loading && !refreshing && result.crews.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isLocation || searching ? (
        <FlatList
          data={result.crews}
          keyExtractor={(c) => c.phone}
          renderItem={({ item }) => <CrewCard crew={item} onPress={() => openCrew(item)} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={empty}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(c) => c.phone}
          renderItem={({ item }) => <CrewCard crew={item} onPress={() => openCrew(item)} />}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          stickySectionHeadersEnabled
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={empty}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </SafeAreaView>
  )
}

function Segment({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.segment, on && styles.segmentOn]}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
    >
      <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLight },
  top: { padding: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  segments: {
    flexDirection: 'row',
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.borderDark,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOn: { backgroundColor: colors.brand },
  segmentText: { fontSize: fontSize.medium, fontWeight: '700', color: colors.textPrimary },
  segmentTextOn: { color: colors.textLight },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.borderDark,
    backgroundColor: colors.background,
  },
  actionPrimary: { backgroundColor: colors.brand, borderColor: colors.brand },
  actionText: { fontSize: fontSize.medium, fontWeight: '700', color: colors.textPrimary },
  actionPrimaryText: { color: colors.textLight },
  locationLabel: { fontSize: fontSize.small, color: colors.textSecondary },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, flexGrow: 1 },
  sectionHeader: {
    paddingVertical: spacing.xs,
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textSecondary,
    backgroundColor: colors.backgroundLight,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
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
  primaryButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.medium,
    backgroundColor: colors.brand,
  },
  primaryButtonText: { color: colors.textLight, fontWeight: '700', fontSize: fontSize.medium },
})
