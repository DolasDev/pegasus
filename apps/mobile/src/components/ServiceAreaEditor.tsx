import React, { useEffect, useState } from 'react'
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator } from 'react-native'
import { countryOfRegion } from '@pegasus/domain'
import { LaborService } from '../services/laborService'
import { useDebouncedValue } from '../utils/useDebouncedValue'
import type { LaborPlace } from '../types/labor'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../theme/colors'

// ---------------------------------------------------------------------------
// Editable chip list of the cities a crew works. Suggestions come from the
// US + Canada place list (GET /labor/places); a typed "City, ST" with a real
// state/province can be added even when the place list doesn't know the city —
// it is kept, just never ranked by distance.
// ---------------------------------------------------------------------------

export interface AreaValue {
  city: string
  region: string
}

interface ServiceAreaEditorProps {
  areas: readonly AreaValue[]
  onChange: (next: AreaValue[]) => void
}

const areaKey = (a: AreaValue) => `${a.city.trim().toLowerCase()}|${a.region.toUpperCase()}`

/** "Spring Hill, TN" → { city, region } when the region is a US state or CA province. */
export function parseTypedArea(text: string): AreaValue | null {
  const m = /^(.+?),\s*([A-Za-z]{2})$/.exec(text.trim())
  if (!m) return null
  const region = m[2]!.toUpperCase()
  return countryOfRegion(region) ? { city: m[1]!.trim(), region } : null
}

export function ServiceAreaEditor({ areas, onChange }: ServiceAreaEditorProps) {
  const [text, setText] = useState('')
  const [places, setPlaces] = useState<LaborPlace[]>([])
  const [loading, setLoading] = useState(false)
  const query = useDebouncedValue(text, 250)

  useEffect(() => {
    let live = true
    if (query.trim().length < 2) {
      setPlaces([])
      return
    }
    setLoading(true)
    LaborService.searchPlaces(query)
      .then((rows) => live && setPlaces(rows))
      .catch(() => live && setPlaces([]))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [query])

  const have = new Set(areas.map(areaKey))
  const add = (a: AreaValue) => {
    setText('')
    setPlaces([])
    if (!have.has(areaKey(a))) onChange([...areas, a])
  }
  const remove = (a: AreaValue) => onChange(areas.filter((x) => areaKey(x) !== areaKey(a)))

  const typed = parseTypedArea(text)
  const suggestions = places.filter((p) => !have.has(areaKey(p)))
  const typedIsSuggested = typed && suggestions.some((p) => areaKey(p) === areaKey(typed))

  return (
    <View>
      <View style={styles.chips}>
        {areas.length === 0 ? <Text style={styles.empty}>No service areas yet</Text> : null}
        {areas.map((a) => (
          <View key={areaKey(a)} style={styles.chip}>
            <Text style={styles.chipText}>
              {a.city}, {a.region}
            </Text>
            <Pressable
              onPress={() => remove(a)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${a.city}, ${a.region}`}
            >
              <Text style={styles.chipRemove}>✕</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Add a city — e.g. Macon or Macon, GA"
        placeholderTextColor={colors.textDisabled}
        autoCorrect={false}
        accessibilityLabel="Add a service area"
      />
      {loading ? <ActivityIndicator style={styles.spinner} color={colors.primary} /> : null}
      {suggestions.map((p) => (
        <Pressable
          key={areaKey(p)}
          style={styles.suggestion}
          onPress={() => add({ city: p.city, region: p.region })}
          accessibilityRole="button"
        >
          <Text style={styles.suggestionText}>
            {p.city}, {p.region}
            <Text style={styles.country}> {p.country}</Text>
          </Text>
        </Pressable>
      ))}
      {typed && !typedIsSuggested && !have.has(areaKey(typed)) ? (
        <Pressable style={styles.suggestion} onPress={() => add(typed)} accessibilityRole="button">
          <Text style={styles.suggestionText}>
            Add “{typed.city}, {typed.region}”
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  empty: { fontSize: fontSize.medium, color: colors.textSecondary },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.backgroundLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: { fontSize: fontSize.medium, color: colors.textPrimary },
  chipRemove: { fontSize: fontSize.small, color: colors.textSecondary },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.medium,
    paddingHorizontal: spacing.md,
    minHeight: touchTarget.minHeight,
    fontSize: fontSize.medium,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  spinner: { marginTop: spacing.sm },
  suggestion: {
    minHeight: touchTarget.minHeight,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  suggestionText: { fontSize: fontSize.medium, color: colors.textPrimary },
  country: { fontSize: fontSize.small, color: colors.textSecondary },
})
