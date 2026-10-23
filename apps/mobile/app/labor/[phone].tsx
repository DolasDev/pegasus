import React, { useCallback, useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { StarRating } from '../../src/components/StarRating'
import { PackerRow } from '../../src/components/PackerRow'
import { ServiceAreaEditor, type AreaValue } from '../../src/components/ServiceAreaEditor'
import { LaborService } from '../../src/services/laborService'
import { laborErrorMessage } from '../../src/services/laborErrors'
import { logger } from '../../src/utils/logger'
import type { LaborCrewDetail, LaborPacker } from '../../src/types/labor'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../../src/theme/colors'

// ---------------------------------------------------------------------------
// One crew: the header (shared name + email, my private nickname, the company
// nickname), its service areas, my rating, and its packers. Name, email, areas
// and packers are shared with every driver who has this number (and with the
// company when it's on the company list); the nickname and rating are mine.
//
// The card opens for a crew in my list, on the company list, or both. Anyone
// may edit everything on it; what differs is the list actions: add to the
// company list / add to my list, and Operations alone may take a crew off the
// company list. My rating, private nickname and "Remove from my list" need the
// crew to be in my own list.
// ---------------------------------------------------------------------------

const errText = (err: unknown) => laborErrorMessage(err)

export default function CrewScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>()
  const router = useRouter()
  const [crew, setCrew] = useState<LaborCrewDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [nickname, setNickname] = useState('')
  const [companyNickname, setCompanyNickname] = useState('')

  const [pendingAreas, setPendingAreas] = useState<AreaValue[] | null>(null)
  const areaSeq = useRef(0)

  const [stars, setStars] = useState<number | null>(null)
  const [comment, setComment] = useState('')

  // The rating inputs are re-synced only on the first load and after a rating
  // save, so saving an area or returning from the packer form never wipes a
  // half-typed comment.
  const ratingSynced = useRef(false)
  const apply = useCallback((next: LaborCrewDetail, syncRating = false) => {
    setCrew(next)
    if (syncRating || !ratingSynced.current) {
      ratingSynced.current = true
      setStars(next.myRating?.stars ?? null)
      setComment(next.myRating?.comment ?? '')
    }
  }, [])

  // Reload on focus — the packer form is a pushed screen.
  useFocusEffect(
    useCallback(() => {
      if (!phone) return
      let live = true
      LaborService.getCrew(phone)
        .then((next) => live && apply(next))
        .catch((err) => {
          logger.warn('Failed to load crew', err)
          if (live) setError(errText(err))
        })
      return () => {
        live = false
      }
    }, [phone, apply]),
  )

  const run = async (
    what: string,
    fn: () => Promise<LaborCrewDetail | void>,
    syncRating = false,
  ) => {
    setBusy(true)
    try {
      const next = await fn()
      if (next) apply(next, syncRating)
      return true
    } catch (err) {
      Alert.alert(what, errText(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  if (error && !crew) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Couldn’t load this crew</Text>
        <Text style={styles.muted}>{error}</Text>
      </View>
    )
  }
  if (!crew) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    )
  }

  const startEdit = () => {
    setName(crew.name)
    setEmail(crew.email ?? '')
    setNickname(crew.nickname ?? '')
    setCompanyNickname(crew.companyNickname ?? '')
    setEditing(true)
  }

  const saveEdit = async () => {
    const shared = { name, email: email.trim() || null }
    const companyName = companyNickname.trim() || null
    const ok = await run('Couldn’t save', async () => {
      // A crew only on the company list has no link of mine to hang a private
      // nickname on, so everything goes through the company route.
      if (!crew.inMyList) {
        return LaborService.updateCompanyCrew(crew.phone, { ...shared, nickname: companyName })
      }
      let next = await LaborService.updateCrew(crew.phone, {
        ...shared,
        nickname: nickname.trim() || null,
      })
      if (crew.inCompanyList && companyName !== crew.companyNickname) {
        next = await LaborService.updateCompanyCrew(crew.phone, { nickname: companyName })
      }
      return next
    })
    if (ok) setEditing(false)
  }

  const addToCompany = () =>
    void run('Couldn’t add to the company list', async () => {
      return (await LaborService.addToCompanyList(crew.phone)).crew
    })

  const addToMine = () =>
    void run('Couldn’t add to your list', () =>
      LaborService.addToMyList({ phone: crew.phone, name: crew.name }),
    )

  const confirmRemoveFromCompany = () =>
    Alert.alert(
      'Remove from the company list?',
      'Drivers will no longer find this crew on the company list. It stays in any driver’s own list, and past jobs keep it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const ok = await run('Couldn’t remove from the company list', async () => {
              await LaborService.removeFromCompanyList(crew.phone)
              // Still reachable through my own list? Stay, with the new flags.
              return crew.inMyList ? LaborService.getCrew(crew.phone) : undefined
            })
            if (ok && !crew.inMyList) router.back()
          },
        },
      ],
    )

  // Optimistic: the chips show the new list at once, so a second quick edit
  // builds on the first rather than on the still-unsaved server copy. Only the
  // latest save's response may replace it; a failure falls back to the server.
  const saveAreas = async (areas: AreaValue[]) => {
    const seq = ++areaSeq.current
    setPendingAreas(areas)
    try {
      const next = await LaborService.setServiceAreas(crew.phone, areas)
      if (seq === areaSeq.current) {
        apply(next)
        setPendingAreas(null)
      }
    } catch (err) {
      if (seq === areaSeq.current) setPendingAreas(null)
      Alert.alert('Couldn’t save service areas', errText(err))
    }
  }

  const saveRating = () => {
    if (stars == null) {
      void run('Couldn’t clear rating', () => LaborService.clearRating(crew.phone), true)
      return
    }
    void run(
      'Couldn’t save rating',
      () => LaborService.rateCrew(crew.phone, { stars, comment: comment.trim() || null }),
      true,
    )
  }

  const ratingDirty =
    stars !== (crew.myRating?.stars ?? null) || comment !== (crew.myRating?.comment ?? '')

  const openPacker = (p?: LaborPacker) =>
    router.push({
      pathname: '/labor/packer',
      params: p ? { phone: crew.phone, id: p.id } : { phone: crew.phone },
    })

  const confirmDeletePacker = (p: LaborPacker) =>
    Alert.alert(
      `Delete ${p.firstName} ${p.lastName}?`,
      'Every driver with this crew will lose this packer.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            void run('Couldn’t delete packer', async () => {
              await LaborService.deletePacker(crew.phone, p.id)
              return LaborService.getCrew(crew.phone)
            }),
        },
      ],
    )

  const confirmRemove = () =>
    Alert.alert(
      'Remove from my list?',
      'Your rating and nickname are deleted. The crew stays available to other drivers.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const ok = await run(
              'Couldn’t remove crew',
              async () => {
                await LaborService.removeCrew(crew.phone)
                // Still on the company list? The card stays, without my rating.
                return crew.inCompanyList ? LaborService.getCrew(crew.phone) : undefined
              },
              true,
            )
            if (ok && !crew.inCompanyList) router.back()
          },
        },
      ],
    )

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.card}>
        {editing ? (
          <>
            <Field label="Crew name (shared)" value={name} onChangeText={setName} />
            <Field
              label="Email (shared)"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
            />
            {crew.inMyList ? (
              <Field
                label="My nickname (only you see it)"
                value={nickname}
                onChangeText={setNickname}
              />
            ) : null}
            {crew.inCompanyList ? (
              <Field
                label="Company nickname (everyone at the company sees it)"
                value={companyNickname}
                onChangeText={setCompanyNickname}
              />
            ) : null}
            <View style={styles.row}>
              <Button label="Cancel" onPress={() => setEditing(false)} />
              <Button label="Save" primary disabled={busy} onPress={() => void saveEdit()} />
            </View>
          </>
        ) : (
          <>
            <View style={styles.headerRow}>
              <Text style={styles.title}>{crew.displayName}</Text>
              <TouchableOpacity onPress={startEdit} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.link}>Edit</Text>
              </TouchableOpacity>
            </View>
            {crew.displayName !== crew.name ? (
              <Text style={styles.muted}>Crew name: {crew.name}</Text>
            ) : null}
            {crew.inCompanyList ? (
              <Text style={styles.tag}>
                On the company list
                {crew.companyNickname ? ` as “${crew.companyNickname}”` : ''}
              </Text>
            ) : null}
            {!crew.inMyList && crew.averageRating ? (
              <Text style={styles.muted}>
                Average from {crew.averageRating.count} drivers:{' '}
                {crew.averageRating.average.toFixed(1)} ★
              </Text>
            ) : null}
            <Text style={styles.phone}>{crew.phoneDisplay}</Text>
            {crew.email ? <Text style={styles.muted}>{crew.email}</Text> : null}
            <View style={styles.row}>
              <Button label="Call" onPress={() => void Linking.openURL(`tel:${crew.phone}`)} />
              <Button label="Text" onPress={() => void Linking.openURL(`sms:${crew.phone}`)} />
              {crew.email ? (
                <Button
                  label="Email"
                  onPress={() => void Linking.openURL(`mailto:${crew.email}`)}
                />
              ) : null}
            </View>
          </>
        )}
      </View>

      {/* Service areas */}
      <Text style={styles.sectionTitle}>Service areas</Text>
      <View style={styles.card}>
        <ServiceAreaEditor
          areas={pendingAreas ?? crew.serviceAreas.map((a) => ({ city: a.city, region: a.region }))}
          onChange={(next) => void saveAreas(next)}
        />
      </View>

      {/* My rating — needs the crew in my own list */}
      {crew.inMyList ? (
        <>
          <Text style={styles.sectionTitle}>My rating</Text>
          <View style={styles.card}>
            <StarRating value={stars} onChange={setStars} size={fontSize.xxlarge} />
            <TextInput
              style={[styles.input, styles.comment]}
              value={comment}
              onChangeText={setComment}
              placeholder="Comment (only you see it)"
              placeholderTextColor={colors.textDisabled}
              multiline
              maxLength={1000}
              accessibilityLabel="Rating comment"
            />
            {crew.averageRating ? (
              <Text style={styles.muted}>
                Average from {crew.averageRating.count} drivers:{' '}
                {crew.averageRating.average.toFixed(1)} ★
              </Text>
            ) : null}
            {ratingDirty ? (
              <View style={styles.row}>
                <Button
                  label={stars == null ? 'Clear rating' : 'Save rating'}
                  primary
                  disabled={busy}
                  onPress={saveRating}
                />
              </View>
            ) : null}
          </View>
        </>
      ) : null}

      {/* Packers */}
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>Packers ({crew.packers.length})</Text>
        <TouchableOpacity onPress={() => openPacker()} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.link}>+ Add packer</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.card}>
        {crew.packers.length === 0 ? (
          <Text style={styles.muted}>No packers yet.</Text>
        ) : (
          crew.packers.map((p) => (
            <PackerRow
              key={p.id}
              packer={p}
              onPress={() => openPacker(p)}
              onLongPress={() => confirmDeletePacker(p)}
            />
          ))
        )}
      </View>

      {crew.inMyList !== crew.inCompanyList ? (
        <View style={styles.row}>
          {crew.inMyList ? (
            <Button label="Add to company list" disabled={busy} onPress={addToCompany} />
          ) : (
            <Button label="Add to my list" disabled={busy} onPress={addToMine} />
          )}
        </View>
      ) : null}

      {crew.inMyList ? (
        <TouchableOpacity style={styles.remove} onPress={confirmRemove} accessibilityRole="button">
          <Text style={styles.removeText}>Remove from my list</Text>
        </TouchableOpacity>
      ) : null}
      {crew.canRemoveFromCompany ? (
        <TouchableOpacity
          style={styles.remove}
          onPress={confirmRemoveFromCompany}
          accessibilityRole="button"
        >
          <Text style={styles.removeText}>Remove from company list</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  )
}

function Field({ label, ...input }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
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

function Button({
  label,
  onPress,
  primary,
  disabled,
}: {
  label: string
  onPress: () => void
  primary?: boolean
  disabled?: boolean
}) {
  return (
    <TouchableOpacity
      style={[styles.button, primary && styles.buttonPrimary, disabled && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text style={[styles.buttonText, primary && styles.buttonPrimaryText]}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLight },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.backgroundLight,
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1, fontSize: fontSize.xlarge, fontWeight: '700', color: colors.textPrimary },
  phone: { fontSize: fontSize.large, color: colors.textPrimary },
  muted: { fontSize: fontSize.medium, color: colors.textSecondary },
  tag: { fontSize: fontSize.small, fontWeight: '700', color: colors.brand },
  link: { fontSize: fontSize.medium, fontWeight: '700', color: colors.brand },
  sectionTitle: {
    fontSize: fontSize.large,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  field: { marginBottom: spacing.sm },
  fieldLabel: { fontSize: fontSize.small, color: colors.textSecondary, marginBottom: spacing.xs },
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
  comment: {
    marginTop: spacing.sm,
    minHeight: 80,
    paddingTop: spacing.sm,
    textAlignVertical: 'top',
  },
  button: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.borderDark,
    backgroundColor: colors.background,
  },
  buttonPrimary: { backgroundColor: colors.brand, borderColor: colors.brand },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: fontSize.medium, fontWeight: '700', color: colors.textPrimary },
  buttonPrimaryText: { color: colors.textLight },
  remove: {
    marginTop: spacing.lg,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { fontSize: fontSize.medium, fontWeight: '700', color: colors.error },
})
