import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { ApiError } from '@pegasus/api-http'
import { DomainError, validatePacker } from '@pegasus/domain'
import { LaborService } from '../../src/services/laborService'
import type { LaborPackerInput } from '../../src/types/labor'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../../src/theme/colors'

// ---------------------------------------------------------------------------
// Add or edit a packer. The rules are the domain's validatePacker — the same
// function the API runs — so a form that passes here is accepted there; the
// only server-side failure left is a duplicate (409 PACKER_DUPLICATE).
//
//   required: first + last name, and one of email / CID number / phone
//   CID issue date: required with a CID number, never in the future
//   identity: last name + CID, or last name + email, unique within the crew
// ---------------------------------------------------------------------------

/** Today as YYYY-MM-DD in the device's own timezone. */
export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Digits typed into the date box → "YYYY-MM-DD" as far as typed. */
export function formatDateInput(text: string): string {
  const d = text.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 4) return d
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`
}

const orNull = (v: string) => (v.trim() ? v.trim() : null)

export default function PackerScreen() {
  const { phone, id } = useLocalSearchParams<{ phone: string; id?: string }>()
  const router = useRouter()
  const editing = !!id

  const [loading, setLoading] = useState(editing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [cidNumber, setCidNumber] = useState('')
  const [cidIssuedOn, setCidIssuedOn] = useState('')
  const [packerPhone, setPackerPhone] = useState('')

  useEffect(() => {
    if (!editing || !phone) return
    let live = true
    LaborService.getCrew(phone)
      .then((crew) => {
        if (!live) return
        const p = crew.packers.find((x) => x.id === id)
        if (!p) {
          setError('This packer no longer exists.')
          return
        }
        setFirstName(p.firstName)
        setLastName(p.lastName)
        setEmail(p.email ?? '')
        setCidNumber(p.cidNumber ?? '')
        setCidIssuedOn(p.cidIssuedOn ?? '')
        setPackerPhone(p.phoneDisplay ?? p.phone ?? '')
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [editing, phone, id])

  const save = async () => {
    const input: LaborPackerInput = {
      firstName,
      lastName,
      email: orNull(email),
      cidNumber: orNull(cidNumber),
      cidIssuedOn: cidNumber.trim() ? orNull(cidIssuedOn) : null,
      phone: orNull(packerPhone),
    }
    try {
      validatePacker(input, localToday())
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
      if (editing) await LaborService.updatePacker(phone, id!, input)
      else await LaborService.addPacker(phone, input)
      router.back()
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'PACKER_DUPLICATE'
          ? 'This crew already has a packer with that last name and CID or email.'
          : err instanceof Error
            ? err.message
            : 'Couldn’t save the packer.',
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ title: editing ? 'Edit packer' : 'Add packer' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field
          label="First name *"
          value={firstName}
          onChangeText={setFirstName}
          autoCapitalize="words"
        />
        <Field
          label="Last name *"
          value={lastName}
          onChangeText={setLastName}
          autoCapitalize="words"
        />
        <Text style={styles.hint}>Plus at least one of email, CID number or phone.</Text>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Field
          label="CID number (Candidate ID)"
          value={cidNumber}
          onChangeText={setCidNumber}
          autoCapitalize="characters"
        />
        {cidNumber.trim() ? (
          <Field
            label="CID issue date *"
            value={cidIssuedOn}
            onChangeText={(t) => setCidIssuedOn(formatDateInput(t))}
            placeholder="YYYY-MM-DD"
            keyboardType="number-pad"
            maxLength={10}
          />
        ) : null}
        <Field
          label="Phone"
          value={packerPhone}
          onChangeText={setPackerPhone}
          keyboardType="phone-pad"
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
            <Text style={styles.saveText}>{editing ? 'Save packer' : 'Add packer'}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
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
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  field: { marginBottom: spacing.md },
  label: { fontSize: fontSize.small, color: colors.textSecondary, marginBottom: spacing.xs },
  hint: { fontSize: fontSize.small, color: colors.textSecondary, marginBottom: spacing.md },
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
