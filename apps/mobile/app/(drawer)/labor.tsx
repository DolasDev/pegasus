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
import { LaborService } from '../../src/services/laborService'
import { exportLaborList, type LaborExportFormat } from '../../src/services/laborExport'
import { useDebouncedValue } from '../../src/utils/useDebouncedValue'
import { logger } from '../../src/utils/logger'
import type { LaborCrew, LaborSearchResult } from '../../src/types/labor'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../../src/theme/colors'

// ---------------------------------------------------------------------------
// Labor — the driver's private book of cash-labor crews.
//
// No search: every crew A–Z, sectioned by initial like the phone's contacts
// app. A ZIP / postal code / "City, ST" / city name: nearest first, with the
// distance on each card. A state or province: the crews serving it.
// ---------------------------------------------------------------------------

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

  const load = useCallback(async (search: string) => {
    const seq = ++requestSeq.current
    setError(null)
    try {
      const res = await LaborService.searchCrews(search)
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
      void load(q)
    }, [load, q]),
  )

  const handleRefresh = async () => {
    setRefreshing(true)
    await load(q)
    setRefreshing(false)
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

  const onAddCrew = () =>
    Alert.alert('Add crew', undefined, [
      { text: 'From contacts', onPress: () => router.push('/labor/import') },
      { text: 'Enter manually', onPress: () => router.push('/labor/new') },
      { text: 'Cancel', style: 'cancel' },
    ])

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
          <TouchableOpacity style={styles.primaryButton} onPress={() => void load(q)}>
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
          <Text style={styles.emptyTitle}>No crews yet</Text>
          <Text style={styles.emptySubtext}>
            Add the labor crews you hire — import them from your contacts or enter one by hand.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={onAddCrew}>
            <Text style={styles.primaryButtonText}>Add Crew</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  )

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <View style={styles.top}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder="ZIP, city, state, name or phone"
        />
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.action, styles.actionPrimary]} onPress={onAddCrew}>
            <Text style={[styles.actionText, styles.actionPrimaryText]}>+ Add Crew</Text>
          </TouchableOpacity>
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
        </View>
        {isLocation ? (
          <Text style={styles.locationLabel}>Nearest to {result.location!.label}</Text>
        ) : null}
      </View>

      {loading && !refreshing && result.crews.length === 0 ? (
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLight },
  top: { padding: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
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
