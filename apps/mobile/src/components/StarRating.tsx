import React from 'react'
import { View, Text, StyleSheet, Pressable } from 'react-native'
import { colors, fontSize } from '../theme/colors'

// ---------------------------------------------------------------------------
// 1–5 stars. Read-only by default; pass `onChange` for the picker, where
// tapping the current value again clears it (onChange(null)).
// ---------------------------------------------------------------------------

interface StarRatingProps {
  value: number | null
  onChange?: (stars: number | null) => void
  size?: number
}

const STARS = [1, 2, 3, 4, 5] as const

export function StarRating({ value, onChange, size = fontSize.medium }: StarRatingProps) {
  const filled = value == null ? 0 : Math.round(value)

  if (!onChange) {
    return (
      <View
        style={styles.row}
        accessible
        accessibilityLabel={value == null ? 'Not rated' : `${value} out of 5 stars`}
      >
        {STARS.map((n) => (
          <Text key={n} style={[styles.star, { fontSize: size }, n <= filled && styles.filled]}>
            {n <= filled ? '★' : '☆'}
          </Text>
        ))}
      </View>
    )
  }

  return (
    <View style={styles.row} accessibilityRole="adjustable">
      {STARS.map((n) => (
        <Pressable
          key={n}
          onPress={() => onChange(n === value ? null : n)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`}
          accessibilityState={{ selected: n <= filled }}
          style={styles.pickerStar}
        >
          <Text style={[styles.star, { fontSize: size }, n <= filled && styles.filled]}>
            {n <= filled ? '★' : '☆'}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  star: { color: colors.textDisabled },
  filled: { color: colors.warning },
  pickerStar: { paddingHorizontal: 4 },
})
