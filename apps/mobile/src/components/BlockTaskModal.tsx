import React, { useEffect, useState } from 'react'
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { DriverTask } from '../types/tasks'
import { colors, fontSize, spacing, borderRadius } from '../theme/colors'

// ---------------------------------------------------------------------------
// "I can't do this" — the reason a driver gives when blocking a To Do task.
// A modal with a text field (Alert.prompt is iOS-only). Operations is told.
// ---------------------------------------------------------------------------

export const BLOCK_REASON_MAX = 500

interface Props {
  task: DriverTask | null
  busy: boolean
  onClose: () => void
  onSubmit: (reason: string) => void
}

export function BlockTaskModal({ task, busy, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState('')
  useEffect(() => setReason(task?.blocked?.reason ?? ''), [task])
  const trimmed = reason.trim()

  return (
    <Modal visible={task != null} animationType="slide" onRequestClose={() => !busy && onClose()}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} disabled={busy} hitSlop={12}>
            <Text style={[styles.headerAction, busy && styles.disabled]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Can’t do it</Text>
          <TouchableOpacity
            onPress={() => onSubmit(trimmed)}
            disabled={busy || trimmed.length === 0}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Send to operations"
          >
            <Text
              style={[
                styles.headerAction,
                styles.send,
                (busy || trimmed.length === 0) && styles.disabled,
              ]}
            >
              Send
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.body}>
          {task ? (
            <Text style={styles.task}>
              {task.title} · #{task.orderNum}
            </Text>
          ) : null}
          <Text style={styles.help}>
            What’s stopping you? Operations will be notified right away.
          </Text>
          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. Customer not home, gate locked"
            multiline
            maxLength={BLOCK_REASON_MAX}
            autoFocus
            accessibilityLabel="Reason"
          />
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: fontSize.large, fontWeight: '700', color: colors.textPrimary },
  headerAction: { fontSize: fontSize.medium, color: colors.primary },
  send: { fontWeight: '700' },
  disabled: { opacity: 0.4 },
  body: { padding: spacing.md, gap: spacing.sm },
  task: { fontSize: fontSize.medium, fontWeight: '600', color: colors.textPrimary },
  help: { fontSize: fontSize.medium, color: colors.textSecondary },
  input: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.medium,
    padding: spacing.sm,
    fontSize: fontSize.medium,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
})
