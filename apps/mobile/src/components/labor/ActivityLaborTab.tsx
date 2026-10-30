import React, { useCallback, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  Share,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import {
  LaborService,
  activityLaborInput,
  withMember,
  withoutCrew,
  withPacker,
} from '../../services/laborService'
import { formatLonghaulDate } from '../../utils/longhaul-format'
import type { LaborActivity, LaborActivityCrew, LaborActivityCrewInput } from '../../types/labor'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../../theme/colors'

// ---------------------------------------------------------------------------
// The shipment's Labor tab: one card per activity of mine on the order, each
// with the crews that worked it and a checklist of their packers, then a
// checklist of My crew (my own packers — "Every job" ones are ticked for me when
// a trip is accepted; anyone else's who worked it shows ticked). Every change
// saves the activity's whole set (PUT /labor/activities/:id); every control on
// the tab is locked until the save answers, so two saves never race.
// Assigning a crew, adding a crew and adding a packer happen on pushed screens,
// so the tab reloads whenever it regains focus.
//
// "Share" on a crew sends its leader a crew link (the native share sheet — the
// driver's own messages app). The leader opens it, gets a texted code on the
// crew's phone, and ticks who works the activities this crew is on. It shows
// only when the company has texting set up (GET /labor/sharing).
// ---------------------------------------------------------------------------

const errText = (err: unknown) => (err instanceof Error ? err.message : 'Please try again.')

/** "Actual 10/22/26", "ETA 10/21/26" or "Planned 10/20/26" — the most settled date. */
export function activityDateLabel(a: LaborActivity): string | null {
  if (a.actualDate) return `Actual ${formatLonghaulDate(a.actualDate)}`
  if (a.estimatedDate) return `ETA ${formatLonghaulDate(a.estimatedDate)}`
  if (a.plannedStart) return `Planned ${formatLonghaulDate(a.plannedStart)}`
  return null
}

export function ActivityLaborTab({ orderNum }: { orderNum: string | number }) {
  const router = useRouter()
  const [activities, setActivities] = useState<LaborActivity[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [sharing, setSharing] = useState(false)

  useFocusEffect(
    useCallback(() => {
      let live = true
      // A failed check hides the action — it never blocks the tab.
      LaborService.getSharing()
        .then((on) => live && setSharing(on))
        .catch(() => live && setSharing(false))
      LaborService.getOrderActivities(orderNum)
        .then((rows) => {
          if (!live) return
          setActivities(rows)
          setError(null)
        })
        .catch((err) => live && setError(errText(err)))
      return () => {
        live = false
      }
    }, [orderNum]),
  )

  // A crew-only change sends no memberIds, leaving My crew as it is.
  const save = (activity: LaborActivity, crews: LaborActivityCrewInput[]) =>
    run(activity, () => LaborService.setActivityLabor(activity.id, crews, undefined))

  // A member toggle re-reads the activity first: the trip-accepted auto-assign
  // may have added members since this tab loaded, and the PUT replaces the set.
  const toggleMember = (activity: LaborActivity, memberId: string, on: boolean) =>
    run(activity, () =>
      LaborService.updateActivityMembers(activity.orderNum, activity.id, (ids) =>
        withMember(ids, memberId, on),
      ),
    )

  const run = async (activity: LaborActivity, write: () => Promise<LaborActivity>) => {
    setSavingId(activity.id)
    try {
      const next = await write()
      setActivities((list) => list?.map((a) => (a.id === next.id ? next : a)) ?? null)
    } catch (err) {
      Alert.alert('Couldn’t save labor', errText(err))
    } finally {
      setSavingId(null)
    }
  }

  const sendLink = async (crew: LaborActivityCrew) => {
    try {
      const { url } = await LaborService.shareCrewLink(orderNum, crew.phone)
      await Share.share({
        message: `Pick who's working order ${orderNum} for ${crew.displayName}: ${url}`,
      })
    } catch (err) {
      Alert.alert('Couldn’t share the link', errText(err))
    }
  }

  const stopSharing = async (crew: LaborActivityCrew) => {
    try {
      await LaborService.stopSharingCrewLink(orderNum, crew.phone)
      Alert.alert('Link stopped', `${crew.displayName}’s link no longer works.`)
    } catch (err) {
      Alert.alert('Couldn’t stop the link', errText(err))
    }
  }

  const shareCrew = (crew: LaborActivityCrew) =>
    Alert.alert(
      `Share with ${crew.displayName}`,
      'Send the crew leader a link to pick who works their activities on this order. ' +
        'Opening it texts a code to the crew’s phone. Sending a new link stops the old one.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Stop sharing', style: 'destructive', onPress: () => void stopSharing(crew) },
        { text: 'Send link', onPress: () => void sendLink(crew) },
      ],
    )

  const removeCrew = (activity: LaborActivity, crew: LaborActivityCrew) =>
    Alert.alert(`Remove ${crew.displayName}?`, 'Its packers come off this activity too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void save(activity, withoutCrew(activityLaborInput(activity), crew.phone)),
      },
    ])

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Couldn’t load labor</Text>
        <Text style={styles.emptySubtext}>{error}</Text>
      </View>
    )
  }
  if (!activities) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    )
  }
  if (activities.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>No activities of yours</Text>
        <Text style={styles.emptySubtext}>
          Labor is recorded on the activities you’re assigned to on this order.
        </Text>
      </View>
    )
  }

  return (
    <View>
      {activities.map((a) => {
        const busy = savingId === a.id
        const locked = !a.editable || savingId != null
        const date = activityDateLabel(a)
        return (
          <View
            key={a.id}
            style={styles.card}
            accessibilityLabel={`Activity ${a.typeName ?? a.id}`}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.activityName}>
                {a.typeName ?? a.typeCode ?? `Activity ${a.id}`}
              </Text>
              {busy ? <ActivityIndicator color={colors.primary} /> : null}
            </View>
            {date ? <Text style={styles.activityDate}>{date}</Text> : null}

            {a.crews.length === 0 ? <Text style={styles.none}>No crew assigned yet.</Text> : null}

            {a.crews.map((crew) => {
              const input = activityLaborInput(a)
              return (
                <View key={crew.phone} style={styles.crew}>
                  <View style={styles.crewHeader}>
                    <View style={styles.crewTitle}>
                      <Text style={styles.crewName}>{crew.displayName}</Text>
                      <Text style={styles.crewPhone}>
                        {crew.phoneDisplay}
                        {crew.inCompanyList && !crew.inMyBook ? ' · Company' : ''}
                      </Text>
                    </View>
                    <SmallButton
                      label="Call"
                      onPress={() => void Linking.openURL(`tel:${crew.phone}`)}
                    />
                    {sharing && a.editable ? (
                      <SmallButton
                        label="Share"
                        accessibilityLabel={`Share link with ${crew.displayName}`}
                        onPress={() => shareCrew(crew)}
                      />
                    ) : null}
                    {a.editable ? (
                      <SmallButton
                        label="Remove"
                        accessibilityLabel={`Remove ${crew.displayName}`}
                        disabled={locked}
                        onPress={() => removeCrew(a, crew)}
                      />
                    ) : null}
                  </View>

                  {crew.packers.length === 0 ? (
                    <Text style={styles.none}>This crew has no packers yet.</Text>
                  ) : null}
                  {crew.packers.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      style={styles.packer}
                      // Someone removed from the crew stays on the jobs they worked.
                      disabled={locked || p.removed === true}
                      onPress={() => void save(a, withPacker(input, crew.phone, p.id, !p.selected))}
                      accessibilityRole="checkbox"
                      accessibilityState={{
                        checked: p.selected,
                        disabled: locked || p.removed === true,
                      }}
                      accessibilityLabel={`${p.firstName} ${p.lastName}`}
                    >
                      <View style={[styles.box, p.selected && styles.boxOn]}>
                        {p.selected ? <Text style={styles.tick}>✓</Text> : null}
                      </View>
                      <Text style={styles.packerName}>
                        {p.firstName} {p.lastName}
                      </Text>
                      {p.removed ? <Text style={styles.everyJob}>Removed</Text> : null}
                    </TouchableOpacity>
                  ))}

                  {a.editable && (crew.inMyBook || crew.inCompanyList) ? (
                    <TouchableOpacity
                      style={styles.link}
                      disabled={locked}
                      onPress={() =>
                        router.push({
                          pathname: '/labor/packer',
                          params: {
                            phone: crew.phone,
                            activityId: String(a.id),
                            orderNum: String(a.orderNum),
                          },
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Add packer to ${crew.displayName}`}
                    >
                      <Text style={styles.linkText}>+ Add packer</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )
            })}

            {a.myCrew && (a.myCrew.length > 0 || a.editable) ? (
              <View style={styles.crew} accessibilityLabel="My crew">
                <Text style={styles.crewName}>My crew</Text>
                {a.myCrew.length === 0 ? (
                  <Text style={styles.none}>No one in your crew yet.</Text>
                ) : null}
                {a.myCrew.map((m) => {
                  // Someone no longer in my crew can only be unticked.
                  const off = locked || !a.editable || (!m.mine && !m.selected)
                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={styles.packer}
                      disabled={off}
                      onPress={() => void toggleMember(a, m.id, !m.selected)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: m.selected, disabled: off }}
                      accessibilityLabel={`${m.firstName} ${m.lastName}`}
                    >
                      <View style={[styles.box, m.selected && styles.boxOn]}>
                        {m.selected ? <Text style={styles.tick}>✓</Text> : null}
                      </View>
                      <Text style={styles.packerName}>
                        {m.firstName} {m.lastName}
                      </Text>
                      {m.everyJob ? <Text style={styles.everyJob}>Every job</Text> : null}
                    </TouchableOpacity>
                  )
                })}
                {a.editable ? (
                  <TouchableOpacity
                    style={styles.link}
                    disabled={locked}
                    onPress={() =>
                      router.push({
                        pathname: '/labor/packer',
                        params: {
                          myCrew: '1',
                          activityId: String(a.id),
                          orderNum: String(a.orderNum),
                        },
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel="Add to my crew"
                  >
                    <Text style={styles.linkText}>+ Add to my crew</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {a.editable ? (
              <TouchableOpacity
                style={[styles.assign, locked && styles.disabled]}
                disabled={locked}
                onPress={() =>
                  router.push({
                    pathname: '/labor/assign',
                    params: { activityId: String(a.id), orderNum: String(a.orderNum) },
                  })
                }
                accessibilityRole="button"
              >
                <Text style={styles.assignText}>Assign crew</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

function SmallButton({
  label,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  accessibilityLabel?: string
}) {
  return (
    <TouchableOpacity
      style={[styles.small, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <Text style={styles.smallText}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', padding: spacing.xl },
  emptyTitle: { fontSize: fontSize.large, fontWeight: '600', color: colors.textPrimary },
  emptySubtext: {
    fontSize: fontSize.medium,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  activityName: { fontSize: fontSize.large, fontWeight: '700', color: colors.textPrimary },
  activityDate: { fontSize: fontSize.small, color: colors.textSecondary, marginTop: 2 },
  none: { fontSize: fontSize.medium, color: colors.textSecondary, marginTop: spacing.sm },
  crew: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  crewHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  crewTitle: { flex: 1 },
  crewName: { fontSize: fontSize.medium, fontWeight: '600', color: colors.textPrimary },
  crewPhone: { fontSize: fontSize.small, color: colors.textSecondary },
  packer: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: touchTarget.minHeight,
    gap: spacing.sm,
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: borderRadius.small,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  tick: { color: colors.textLight, fontWeight: '700' },
  packerName: { fontSize: fontSize.medium, color: colors.textPrimary },
  everyJob: { fontSize: fontSize.small, color: colors.textSecondary, marginLeft: 'auto' },
  link: { minHeight: touchTarget.minHeight, justifyContent: 'center' },
  linkText: { fontSize: fontSize.medium, fontWeight: '600', color: colors.primary },
  assign: {
    marginTop: spacing.md,
    minHeight: touchTarget.minHeight,
    borderRadius: borderRadius.medium,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignText: { fontSize: fontSize.medium, fontWeight: '700', color: colors.textLight },
  small: {
    paddingHorizontal: spacing.sm,
    minHeight: 36,
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  smallText: { fontSize: fontSize.small, fontWeight: '600', color: colors.primary },
  disabled: { opacity: 0.5 },
})
