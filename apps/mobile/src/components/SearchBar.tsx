import React from 'react'
import { View, TextInput, Pressable, Text, StyleSheet } from 'react-native'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../theme/colors'

interface SearchBarProps {
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
}

export function SearchBar({ value, onChangeText, placeholder = 'Search' }: SearchBarProps) {
  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textDisabled}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="never"
        accessibilityLabel={placeholder}
      />
      {value ? (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          style={styles.clear}
        >
          <Text style={styles.clearText}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.medium,
    paddingHorizontal: spacing.md,
    minHeight: touchTarget.minHeight,
  },
  input: {
    flex: 1,
    fontSize: fontSize.medium,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  clear: { paddingLeft: spacing.sm },
  clearText: { fontSize: fontSize.medium, color: colors.textSecondary },
})
