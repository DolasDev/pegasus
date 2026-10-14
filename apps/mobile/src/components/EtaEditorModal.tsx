import React, { useEffect, useState } from 'react'
import {
  Modal,
  View,
  Text,
  ScrollView,
  StyleSheet,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../theme/colors'
import { TripService } from '../services/tripService'
import type { DriverEtaUpdate, LonghaulActivity } from '../types/longhaul'
import {
  COMMITMENT_EXPLANATION,
  US_TIME_ZONES,
  activityHasEta,
  arrivalWindowError,
  confirmAlertMessage,
  describeCommitment,
  etaActivityLabel,
  formatArrivalWindow,
  formatEtaDate,
  formatHhMm,
  isCommitted,
  isValidHhMm,
  reconfirmAlertMessage,
  shiftDateOnly,
  shiftHhMm,
  toDateOnly,
  todayDateOnly,
} from '../utils/driver-eta'
import { logger } from '../utils/logger'

// ---------------------------------------------------------------------------
// Set the ETA on a Delivery / SIT-IN activity and mark it Confirmed.
//
// Confirmed means the driver AND the shipper have committed to the date, so
// the switch carries an always-visible explanation and saving a Confirmed ETA
// asks once more in words. Editing an ETA that was already Confirmed asks the
// driver to re-confirm with the shipper or save it as not confirmed — it never
// silently keeps the old commitment on a new date.
//
// Activity types without an ETA date (isHasETA = false) only take an arrival
// window, which applies to the activity's planned start day.
//
// Steppers instead of a native date picker: no new native dependency (nothing
// for `expo install --check` to flag), and every target is a large touch target.
// ---------------------------------------------------------------------------

const WINDOW_STEP_MINUTES = 30
const DEFAULT_WINDOW = { start: '08:00', end: '10:00' }

interface Props {
  visible: boolean
  activity: LonghaulActivity | null
  onClose: () => void
  onSaved: (updated: LonghaulActivity) => void
}

interface Draft {
  date: string
  includeWindow: boolean
  start: string
  end: string
  tz: string | null
  committed: boolean
}

function initialDraft(activity: LonghaulActivity): Draft {
  const hasEta = activityHasEta(activity)
  const hasWindow =
    isValidHhMm(activity.arrival_window_start) && isValidHhMm(activity.arrival_window_end)
  return {
    date:
      toDateOnly(activity.estimated_date) ?? toDateOnly(activity.planned_start) ?? todayDateOnly(),
    includeWindow: hasEta ? hasWindow : true,
    start: hasWindow ? activity.arrival_window_start! : DEFAULT_WINDOW.start,
    end: hasWindow ? activity.arrival_window_end! : DEFAULT_WINDOW.end,
    tz: activity.arrival_window_tz ?? activity.arrival_window_tz_suggested ?? null,
    committed: isCommitted(activity),
  }
}

export function EtaEditorModal({ visible, activity, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<Draft | null>(activity ? initialDraft(activity) : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (visible && activity) {
      setDraft(initialDraft(activity))
      setError(null)
      setBusy(false)
    }
  }, [visible, activity])

  if (!activity || !draft) return null

  const hasEta = activityHasEta(activity)
  const wasCommitted = isCommitted(activity)
  const update = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  const original = {
    date: hasEta ? toDateOnly(activity.estimated_date) : null,
    window: formatArrivalWindow(
      activity.arrival_window_start,
      activity.arrival_window_end,
      activity.arrival_window_tz,
    ),
  }
  const next = {
    date: hasEta ? draft.date : null,
    window: draft.includeWindow ? formatArrivalWindow(draft.start, draft.end, draft.tz) : null,
  }
  // The window-only types anchor to the planned start day.
  const anchorDate = hasEta ? draft.date : toDateOnly(activity.planned_start)
  const changed = original.date !== next.date || original.window !== next.window

  const submit = async (committed: boolean) => {
    const body: DriverEtaUpdate = { committed }
    if (hasEta) body.estimated_date = draft.date
    if (draft.includeWindow) {
      body.arrival_window_start = draft.start
      body.arrival_window_end = draft.end
      body.arrival_window_tz = draft.tz
    } else if (original.window) {
      // Turned the window off — clear the stored one.
      body.arrival_window_start = null
      body.arrival_window_end = null
      body.arrival_window_tz = null
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await TripService.updateActivityEta(activity.id, body)
      onSaved(updated)
    } catch (err) {
      logger.error('Driver ETA save failed', err)
      setError(err instanceof Error ? err.message : 'Could not save the ETA. Please try again.')
      setBusy(false)
    }
  }

  const handleSave = () => {
    if (draft.includeWindow) {
      const windowError = arrivalWindowError(draft.start, draft.end, draft.tz)
      if (windowError) {
        setError(windowError)
        return
      }
    }
    setError(null)
    const committedTo = describeCommitment(anchorDate, next.window)

    if (draft.committed && wasCommitted && changed) {
      Alert.alert(
        'Re-confirm with the shipper?',
        reconfirmAlertMessage(describeCommitment(original.date, original.window), committedTo),
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save as not confirmed', onPress: () => void submit(false) },
          { text: 'Re-confirm with shipper', onPress: () => void submit(true) },
        ],
      )
      return
    }
    if (draft.committed && !wasCommitted) {
      Alert.alert('Confirm with the shipper?', confirmAlertMessage(committedTo), [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => void submit(true) },
      ])
      return
    }
    void submit(draft.committed)
  }

  const close = () => {
    if (!busy) onClose()
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={close} disabled={busy} hitSlop={12}>
            <Text style={[styles.headerAction, busy && styles.disabled]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{hasEta ? 'Set ETA' : 'Arrival window'}</Text>
          <TouchableOpacity onPress={handleSave} disabled={busy} hitSlop={12}>
            <Text style={[styles.headerAction, styles.save, busy && styles.disabled]}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.activityTitle}>
            {etaActivityLabel(activity)}
            {activity.order_num ? ` · #${activity.order_num}` : ''}
          </Text>

          {hasEta ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Delivery date</Text>
              <View style={styles.stepperRow}>
                <StepButton
                  label="‹"
                  accessibilityLabel="Previous day"
                  onPress={() => update({ date: shiftDateOnly(draft.date, -1) })}
                  disabled={busy}
                />
                <Text style={styles.stepperValue} testID="eta-date">
                  {formatEtaDate(draft.date)}
                </Text>
                <StepButton
                  label="›"
                  accessibilityLabel="Next day"
                  onPress={() => update({ date: shiftDateOnly(draft.date, 1) })}
                  disabled={busy}
                />
              </View>
            </View>
          ) : (
            <Text style={styles.hint}>
              This activity has no ETA date. Set the arrival window for{' '}
              {formatEtaDate(activity.planned_start)}.
            </Text>
          )}

          <View style={styles.card}>
            <View style={styles.switchRow}>
              <Text style={styles.sectionTitle}>Arrival window</Text>
              {hasEta ? (
                <Switch
                  value={draft.includeWindow}
                  onValueChange={(v) => update({ includeWindow: v })}
                  disabled={busy}
                  accessibilityLabel="Include arrival window"
                />
              ) : null}
            </View>
            {draft.includeWindow ? (
              <>
                <TimeStepper
                  label="From"
                  value={draft.start}
                  onChange={(start) => update({ start })}
                  disabled={busy}
                />
                <TimeStepper
                  label="To"
                  value={draft.end}
                  onChange={(end) => update({ end })}
                  disabled={busy}
                />
                <Text style={styles.fieldLabel}>Time zone of the delivery address</Text>
                <View style={styles.zoneRow}>
                  {US_TIME_ZONES.map((z) => (
                    <TouchableOpacity
                      key={z.id}
                      style={[styles.zoneChip, draft.tz === z.id && styles.zoneChipSelected]}
                      onPress={() => update({ tz: z.id })}
                      disabled={busy}
                      accessibilityLabel={`${z.label} time`}
                      accessibilityState={{ selected: draft.tz === z.id }}
                    >
                      <Text
                        style={[
                          styles.zoneChipText,
                          draft.tz === z.id && styles.zoneChipTextSelected,
                        ]}
                      >
                        {z.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : null}
          </View>

          <View style={[styles.card, draft.committed && styles.commitCardOn]}>
            <View style={styles.switchRow}>
              <Text style={styles.commitTitle}>Mark as Confirmed</Text>
              <Switch
                value={draft.committed}
                onValueChange={(v) => update({ committed: v })}
                disabled={busy}
                accessibilityLabel="Mark as Confirmed"
              />
            </View>
            <Text style={styles.commitExplanation}>
              <Text style={styles.commitEmphasis}>
                Confirmed means both you and the shipper have committed to this delivery date.{' '}
              </Text>
              {COMMITMENT_EXPLANATION}
            </Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {busy ? <ActivityIndicator color={colors.primary} /> : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

function StepButton({
  label,
  accessibilityLabel,
  onPress,
  disabled,
}: {
  label: string
  accessibilityLabel: string
  onPress: () => void
  disabled: boolean
}) {
  return (
    <TouchableOpacity
      style={styles.stepButton}
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={styles.stepButtonText}>{label}</Text>
    </TouchableOpacity>
  )
}

function TimeStepper({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  return (
    <View style={styles.timeRow}>
      <Text style={styles.timeLabel}>{label}</Text>
      <StepButton
        label="−"
        accessibilityLabel={`${label} earlier`}
        onPress={() => onChange(shiftHhMm(value, -WINDOW_STEP_MINUTES))}
        disabled={disabled}
      />
      <Text style={styles.stepperValue} testID={`window-${label.toLowerCase()}`}>
        {formatHhMm(value)}
      </Text>
      <StepButton
        label="+"
        accessibilityLabel={`${label} later`}
        onPress={() => onChange(shiftHhMm(value, WINDOW_STEP_MINUTES))}
        disabled={disabled}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLight },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  headerTitle: { fontSize: fontSize.large, fontWeight: '700', color: colors.textPrimary },
  headerAction: { fontSize: fontSize.medium, color: colors.textSecondary },
  save: { color: colors.primary, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  body: { padding: spacing.md, gap: spacing.md },
  activityTitle: { fontSize: fontSize.large, fontWeight: '700', color: colors.textPrimary },
  card: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    borderWidth: 2,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  hint: { fontSize: fontSize.medium, color: colors.textSecondary },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepperValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.large,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  stepButton: {
    minWidth: touchTarget.minHeight,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.borderDark,
    backgroundColor: colors.backgroundLight,
  },
  stepButtonText: { fontSize: fontSize.xlarge, fontWeight: '700', color: colors.textPrimary },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  timeLabel: { width: 48, fontSize: fontSize.medium, color: colors.textSecondary },
  fieldLabel: { fontSize: fontSize.small, fontWeight: '600', color: colors.textSecondary },
  zoneRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  zoneChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.borderDark,
  },
  zoneChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  zoneChipText: { fontSize: fontSize.small, fontWeight: '600', color: colors.textPrimary },
  zoneChipTextSelected: { color: colors.textLight },
  commitCardOn: { borderColor: colors.success },
  commitTitle: { fontSize: fontSize.large, fontWeight: '700', color: colors.textPrimary },
  commitExplanation: { fontSize: fontSize.medium, color: colors.textSecondary },
  commitEmphasis: { fontWeight: '700', color: colors.textPrimary },
  error: { fontSize: fontSize.medium, color: colors.error },
})
