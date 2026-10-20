import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Contacts from 'expo-contacts'
import { SearchBar } from '../../src/components/SearchBar'
import { LaborService } from '../../src/services/laborService'
import {
  loadPhoneContacts,
  type ContactCandidate,
  type ContactsLoadResult,
} from '../../src/services/laborContacts'
import { logger } from '../../src/utils/logger'
import type { LaborImportResult } from '../../src/types/labor'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../../src/theme/colors'

// ---------------------------------------------------------------------------
// Import crews from the phone's contacts: pick contacts (and, for a contact
// with several numbers, which number is the crew), then one batch POST.
// Contacts already in the Labor list show as "Added" and can't be picked.
// ---------------------------------------------------------------------------

/** The API's batch limit (MAX_IMPORT_ROWS). */
const BATCH = 200

export function summarizeImport(results: readonly LaborImportResult[]): string {
  const count = (o: LaborImportResult['outcome']) => results.filter((r) => r.outcome === o).length
  const added = count('added') + count('linkedExisting')
  const parts = [`${added} crew${added === 1 ? '' : 's'} added.`]
  if (count('alreadyInList')) parts.push(`${count('alreadyInList')} already in your list.`)
  if (count('invalid')) parts.push(`${count('invalid')} skipped — not a valid phone number.`)
  if (count('rateLimited')) {
    parts.push(`${count('rateLimited')} not added — daily limit reached, try again tomorrow.`)
  }
  return parts.join(' ')
}

export default function ImportContactsScreen() {
  const router = useRouter()
  const [load, setLoad] = useState<ContactsLoadResult | null>(null)
  const [mine, setMine] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  /** contact id → the chosen E.164 number */
  const [picked, setPicked] = useState<Map<string, string>>(new Map())
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    setError(null)
    try {
      const [contacts, crews] = await Promise.all([
        loadPhoneContacts(),
        LaborService.searchCrews(''),
      ])
      setMine(new Set(crews.crews.map((c) => c.phone)))
      setLoad(contacts)
    } catch (err) {
      logger.warn('Failed to load contacts for labor import', err)
      setError(err instanceof Error ? err.message : 'Couldn’t read your contacts')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const visible = useMemo(() => {
    const all = load?.contacts ?? []
    const q = query.trim().toLowerCase()
    if (!q) return all
    const digits = q.replace(/\D/g, '')
    return all.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (digits.length >= 3 && c.numbers.some((n) => n.e164.includes(digits))),
    )
  }, [load, query])

  const isAdded = (c: ContactCandidate) => c.numbers.some((n) => mine.has(n.e164))

  const toggle = (c: ContactCandidate) =>
    setPicked((prev) => {
      const next = new Map(prev)
      if (next.has(c.id)) next.delete(c.id)
      else next.set(c.id, c.numbers[0]!.e164)
      return next
    })

  const chooseNumber = (c: ContactCandidate, e164: string) =>
    setPicked((prev) => new Map(prev).set(c.id, e164))

  const submit = async () => {
    const byId = new Map((load?.contacts ?? []).map((c) => [c.id, c]))
    const rows = [...picked.entries()].map(([id, phone]) => {
      const c = byId.get(id)!
      return { phone, name: c.name, email: c.email }
    })
    setSaving(true)
    try {
      const results: LaborImportResult[] = []
      for (let i = 0; i < rows.length; i += BATCH) {
        results.push(...(await LaborService.importCrews(rows.slice(i, i + BATCH))))
      }
      Alert.alert('Import finished', summarizeImport(results), [
        { text: 'OK', onPress: () => router.back() },
      ])
    } catch (err) {
      Alert.alert('Import failed', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Couldn’t read your contacts</Text>
        <Text style={styles.muted}>{error}</Text>
        <Button label="Try again" onPress={() => void reload()} />
      </View>
    )
  }
  if (!load) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    )
  }
  if (load.access === 'denied') {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Contacts access is off</Text>
        <Text style={styles.muted}>
          Allow Pegasus to read your contacts to import crews. Nothing is uploaded except the
          contacts you pick.
        </Text>
        {load.canAskAgain ? (
          <Button label="Allow access" onPress={() => void reload()} />
        ) : (
          <Button label="Open Settings" onPress={() => void Linking.openSettings()} />
        )}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <View style={styles.top}>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search contacts" />
        {load.access === 'limited' ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Pegasus can see only the contacts you shared.</Text>
            <TouchableOpacity
              onPress={() =>
                void Contacts.presentAccessPickerAsync()
                  .then(() => reload())
                  .catch(() => undefined)
              }
              accessibilityRole="button"
            >
              <Text style={styles.link}>Choose more</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <FlatList
        data={visible}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={[styles.muted, styles.empty]}>
            {query ? 'No matching contacts.' : 'No contacts with a phone number.'}
          </Text>
        }
        renderItem={({ item }) => {
          const added = isAdded(item)
          const chosen = picked.get(item.id)
          return (
            <View style={styles.row}>
              <TouchableOpacity
                style={styles.rowMain}
                onPress={() => toggle(item)}
                disabled={added}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!chosen, disabled: added }}
                accessibilityLabel={item.name}
              >
                <View style={[styles.check, chosen && styles.checkOn, added && styles.checkAdded]}>
                  <Text style={styles.checkMark}>{chosen || added ? '✓' : ''}</Text>
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.name}>{item.name}</Text>
                  {added ? (
                    <Text style={styles.added}>Added</Text>
                  ) : item.numbers.length === 1 || !chosen ? (
                    <Text style={styles.muted}>{item.numbers[0]!.display}</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
              {chosen && item.numbers.length > 1 ? (
                <View style={styles.numbers}>
                  {item.numbers.map((n) => (
                    <TouchableOpacity
                      key={n.e164}
                      style={[styles.number, n.e164 === chosen && styles.numberOn]}
                      onPress={() => chooseNumber(item, n.e164)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: n.e164 === chosen }}
                    >
                      <Text style={[styles.numberText, n.e164 === chosen && styles.numberTextOn]}>
                        {n.label}: {n.display}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>
          )
        }}
      />

      <View style={styles.footer}>
        <Button
          label={
            saving
              ? 'Importing…'
              : picked.size
                ? `Import ${picked.size} crew${picked.size === 1 ? '' : 's'}`
                : 'Select contacts to import'
          }
          onPress={() => void submit()}
          disabled={saving || picked.size === 0}
        />
      </View>
    </SafeAreaView>
  )
}

function Button({
  label,
  onPress,
  disabled,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <TouchableOpacity
      style={[styles.button, disabled && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLight },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: colors.backgroundLight,
  },
  title: {
    fontSize: fontSize.xlarge,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  muted: { fontSize: fontSize.medium, color: colors.textSecondary },
  empty: { textAlign: 'center', marginTop: spacing.xl },
  top: { padding: spacing.md, gap: spacing.sm },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: borderRadius.medium,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  bannerText: { flex: 1, fontSize: fontSize.small, color: colors.textPrimary },
  link: { fontSize: fontSize.medium, fontWeight: '700', color: colors.brand },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, flexGrow: 1 },
  row: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    minHeight: touchTarget.minHeight,
  },
  rowText: { flex: 1 },
  name: { fontSize: fontSize.medium, fontWeight: '600', color: colors.textPrimary },
  added: { fontSize: fontSize.small, fontWeight: '700', color: colors.success },
  check: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.borderDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkAdded: { backgroundColor: colors.success, borderColor: colors.success },
  checkMark: { color: colors.textLight, fontWeight: '700' },
  numbers: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  number: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.borderDark,
  },
  numberOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  numberText: { fontSize: fontSize.small, color: colors.textPrimary },
  numberTextOn: { color: colors.textLight },
  footer: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  button: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.medium,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: fontSize.medium, fontWeight: '700', color: colors.textLight },
})
