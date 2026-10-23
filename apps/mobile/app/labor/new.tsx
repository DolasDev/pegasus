import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { DomainError, validateCrew } from '@pegasus/domain'
import { LaborService, withCrew } from '../../src/services/laborService'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../../src/theme/colors'

// ---------------------------------------------------------------------------
// Add one crew by hand. The phone number IS the crew: if another driver has
// already added it, this links to their record (and its packers) instead of
// creating a second one, and the name typed here becomes my nickname.
//
// Opened from an activity's crew picker (`activityId` + `orderNum`), the new
// crew is also assigned to that activity, and the form returns past the picker
// straight to the shipment's Labor tab.
// ---------------------------------------------------------------------------

export default function NewCrewScreen() {
  const { activityId, orderNum } = useLocalSearchParams<{
    activityId?: string
    orderNum?: string
  }>()
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const input = { phone, name, email: email.trim() || null }
    try {
      validateCrew(input)
    } catch (err) {
      if (err instanceof DomainError) {
        setError(err.message)
        return
      }
      throw err
    }
    setSaving(true)
    setError(null)
    try {
      const { crew, outcome } = await LaborService.addCrew(input)
      if (activityId && orderNum) {
        try {
          await LaborService.updateActivityLabor(orderNum, Number(activityId), (set) =>
            withCrew(set, crew.phone),
          )
        } catch (err) {
          // The crew is in my list now — back on the picker it can be picked again.
          Alert.alert(
            'Crew added, not assigned',
            err instanceof Error ? err.message : 'Pick it from your list to assign it.',
          )
          router.back()
          return
        }
        router.dismiss(2)
      } else {
        router.replace({ pathname: '/labor/[phone]', params: { phone: crew.phone } })
      }
      if (outcome === 'linkedExisting') {
        Alert.alert(
          'Crew already in Pegasus',
          `Another driver added ${crew.phoneDisplay} as “${crew.name}”. You now share its packers and service areas; “${name.trim()}” is saved as your nickname.`,
        )
      } else if (outcome === 'alreadyInList') {
        Alert.alert('Already in your list', `${crew.displayName} is already one of your crews.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t add the crew.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Field label="Phone *" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Crew name *" value={name} onChangeText={setName} autoCapitalize="words" />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <TouchableOpacity
        style={[styles.save, saving && styles.saveDisabled]}
        onPress={() => void save()}
        disabled={saving}
        accessibilityRole="button"
      >
        {saving ? (
          <ActivityIndicator color={colors.textLight} />
        ) : (
          <Text style={styles.saveText}>Add crew</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  )
}

function Field({ label, ...input }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        autoCorrect={false}
        placeholderTextColor={colors.textDisabled}
        accessibilityLabel={label}
        {...input}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLight },
  content: { padding: spacing.md },
  field: { marginBottom: spacing.md },
  label: { fontSize: fontSize.small, color: colors.textSecondary, marginBottom: spacing.xs },
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
  error: { fontSize: fontSize.medium, color: colors.error, marginBottom: spacing.md },
  save: {
    minHeight: touchTarget.minHeight,
    borderRadius: borderRadius.medium,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveDisabled: { opacity: 0.6 },
  saveText: { fontSize: fontSize.medium, fontWeight: '700', color: colors.textLight },
})
