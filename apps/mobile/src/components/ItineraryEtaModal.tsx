import React, { useEffect, useState } from 'react'
import { Modal, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { ItineraryItem } from '../types/itinerary'
import { addDays, formatDay } from '../utils/itinerary'
import { colors, fontSize, spacing, borderRadius } from '../theme/colors'

// ---------------------------------------------------------------------------
// The driver's ETA for one local or order-assigned act — a Pegasus fact, never
// written to legacy (the dispatcher's own ETA there is what the customer is
// emailed). A trip activity's ETA is NOT set here: it has the trip screen's
// editor, which does write legacy.
// ---------------------------------------------------------------------------

export interface EtaDraft {
  day: string
  window: { start: string; end: string } | null
}

interface Props {
  item: ItineraryItem | null
  busy: boolean
  onClose: () => void
  onSave: (eta: EtaDraft | null) => void
}

const STEP_MINUTES = 30

/** `HH:mm` plus `minutes`, kept within one day. */
export function shiftTime(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = Math.min(Math.max(h * 60 + m + minutes, 0), 23 * 60 + 30)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function initialDraft(item: ItineraryItem): EtaDraft {
  const eta = item.assertion?.eta
  if (eta) return { day: eta.day, window: eta.window }
  return { day: item.day, window: null }
}

export function ItineraryEtaModal({ item, busy, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<EtaDraft | null>(item ? initialDraft(item) : null)
  useEffect(() => setDraft(item ? initialDraft(item) : null), [item])

  const close = () => {
    if (!busy) onClose()
  }

  const setWindow = (start: string, end: string) =>
    setDraft((d) => (d ? { ...d, window: { start, end: end < start ? start : end } } : d))

  return (
    <Modal visible={item != null} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={close} disabled={busy} hitSlop={12}>
            <Text style={[styles.headerAction, busy && styles.disabled]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Your ETA</Text>
          <TouchableOpacity
            onPress={() => draft && onSave(draft)}
            disabled={busy || !draft}
            hitSlop={12}
          >
            <Text style={[styles.headerAction, busy && styles.disabled]}>Save</Text>
          </TouchableOpacity>
        </View>

        {item && draft ? (
          <View style={styles.body}>
            <Text style={styles.title}>
              {item.actName} · #{item.orderNum}
            </Text>
            <Text style={styles.hint}>
              Shared with dispatch in Pegasus. It does not change the time your dispatcher gave the
              customer.
            </Text>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Day</Text>
              <View style={styles.stepperRow}>
                <Step
                  label="‹"
                  accessibilityLabel="Previous day"
                  onPress={() => setDraft({ ...draft, day: addDays(draft.day, -1) })}
                  disabled={busy}
                />
                <Text style={styles.stepperValue} testID="eta-day">
                  {formatDay(draft.day)}
                </Text>
                <Step
                  label="›"
                  accessibilityLabel="Next day"
                  onPress={() => setDraft({ ...draft, day: addDays(draft.day, 1) })}
                  disabled={busy}
                />
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.switchRow}>
                <Text style={styles.sectionTitle}>Arrival window</Text>
                <Switch
                  value={draft.window !== null}
                  onValueChange={(on) =>
                    setDraft({ ...draft, window: on ? { start: '08:00', end: '10:00' } : null })
                  }
                  disabled={busy}
                  accessibilityLabel="Include arrival window"
                />
              </View>
              {draft.window ? (
                <>
                  <TimeRow
                    label="From"
                    value={draft.window.start}
                    onStep={(n) => setWindow(shiftTime(draft.window!.start, n), draft.window!.end)}
                    disabled={busy}
                  />
                  <TimeRow
                    label="To"
                    value={draft.window.end}
                    onStep={(n) => setWindow(draft.window!.start, shiftTime(draft.window!.end, n))}
                    disabled={busy}
                  />
                </>
              ) : null}
            </View>

            {item.assertion?.eta ? (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => onSave(null)}
                disabled={busy}
                accessibilityRole="button"
              >
                <Text style={styles.clearText}>Clear my ETA</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  )
}

function Step({
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
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={styles.step}
      hitSlop={8}
    >
      <Text style={styles.stepText}>{label}</Text>
    </TouchableOpacity>
  )
}

function TimeRow({
  label,
  value,
  onStep,
  disabled,
}: {
  label: string
  value: string
  onStep: (minutes: number) => void
  disabled: boolean
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.timeLabel}>{label}</Text>
      <Step
        label="−"
        accessibilityLabel={`${label} earlier`}
        onPress={() => onStep(-STEP_MINUTES)}
        disabled={disabled}
      />
      <Text style={styles.stepperValue}>{value}</Text>
      <Step
        label="+"
        accessibilityLabel={`${label} later`}
        onPress={() => onStep(STEP_MINUTES)}
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
    padding: spacing.md,
    backgroundColor: colors.backgroundDark,
  },
  headerTitle: { color: colors.textLight, fontSize: fontSize.xlarge, fontWeight: '700' },
  headerAction: { color: colors.textLight, fontSize: fontSize.large, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  body: { padding: spacing.md, gap: spacing.md },
  title: { fontSize: fontSize.xlarge, fontWeight: '700', color: colors.textPrimary },
  hint: { fontSize: fontSize.medium, color: colors.textSecondary },
  card: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: { fontSize: fontSize.large, fontWeight: '700', color: colors.textPrimary },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepperValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.large,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  timeLabel: { width: 48, fontSize: fontSize.medium, color: colors.textSecondary },
  step: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepText: { fontSize: fontSize.xlarge, fontWeight: '700', color: colors.textPrimary },
  clearButton: { alignSelf: 'center', padding: spacing.md },
  clearText: { fontSize: fontSize.medium, color: colors.error, fontWeight: '600' },
})
