import React, { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { ApiError } from '@pegasus/api-http'
import { MAX_CHAT_BODY_LENGTH, splitMentions } from '@pegasus/domain'
import { useChat } from '../../chat/ChatContext'
import { useChatThread } from '../../chat/useChatThread'
import type { PendingMessage } from '../../chat/thread-state'
import { dayKey, dayLabel, formatClock, initials } from '../../chat/format'
import type { ChatMessage } from '../../services/chatService'
import { borderRadius, colors, fontSize, spacing } from '../../theme/colors'

// ---------------------------------------------------------------------------
// One move's conversation, laid out like a phone's texting app: bubbles (mine
// on the right), day dividers, older history on scroll-up, and a composer
// pinned above the keyboard. Used full-screen (app/chat/[orderNum].tsx) and as
// the shipment screen's Chat tab — never inside a ScrollView, because the
// inverted FlatList owns scrolling.
//
// Mentions in received messages render as "@Name"; this composer has no @
// picker (a Phase 3 scope cut — the web page has one).
// ---------------------------------------------------------------------------

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: ChatMessage; mine: boolean; showAuthor: boolean }
  | { kind: 'pending'; key: string; pending: PendingMessage }

/** Newest first, for an inverted list: rows, then each day's divider above it. */
export function buildRows(
  messages: readonly ChatMessage[],
  pending: readonly PendingMessage[],
  myUserId: string | null,
  now: Date = new Date(),
): Row[] {
  const out: Row[] = []
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i] as PendingMessage
    out.push({ kind: 'pending', key: `p:${p.clientMessageId}`, pending: p })
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as ChatMessage
    const prev = messages[i - 1]
    const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)
    const mine = myUserId != null && m.author.id === myUserId
    out.push({
      kind: 'message',
      key: m.id,
      message: m,
      mine,
      showAuthor: !mine && (newDay || prev?.author.id !== m.author.id),
    })
    if (newDay)
      out.push({ kind: 'day', key: `d:${dayKey(m.createdAt)}`, label: dayLabel(m.createdAt, now) })
  }
  return out
}

function errorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 403)
    return 'This move’s chat isn’t open to you.'
  if (error instanceof ApiError && error.status === 404) return 'Order not found.'
  return 'Couldn’t load messages. Check your connection and try again.'
}

export function ChatThreadView({ orderNum }: { orderNum: number }) {
  const { myUserId, refreshInbox } = useChat()
  const thread = useChatThread(orderNum, myUserId, () => void refreshInbox())
  const { state } = thread
  const [draft, setDraft] = useState('')

  const rows = useMemo(
    () => buildRows(state.messages, state.pending, myUserId),
    [state.messages, state.pending, myUserId],
  )

  const submit = () => {
    const body = draft.trim()
    if (!body) return
    thread.send(body)
    setDraft('')
  }

  const confirmDelete = (m: ChatMessage) => {
    Alert.alert('Delete message?', 'It will show as deleted for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          thread.remove(m.id).catch(() => Alert.alert('Couldn’t delete the message.'))
        },
      },
    ])
  }

  if (thread.error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>{errorText(thread.error)}</Text>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
    >
      {!state.loaded ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          style={styles.flex}
          contentContainerStyle={styles.list}
          inverted
          data={rows}
          keyExtractor={(r) => r.key}
          onEndReached={() => {
            if (state.hasOlder && !thread.loadingOlder)
              void thread.loadOlder().catch(() => undefined)
          }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            thread.loadingOlder ? <ActivityIndicator color={colors.textSecondary} /> : null
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>No messages yet. Say hello to the office.</Text>
            </View>
          }
          renderItem={({ item }) => {
            if (item.kind === 'day') {
              return <Text style={styles.day}>{item.label}</Text>
            }
            if (item.kind === 'pending') {
              return (
                <PendingBubble
                  pending={item.pending}
                  onRetry={() => thread.retry(item.pending.clientMessageId)}
                  onDiscard={() => thread.discard(item.pending.clientMessageId)}
                />
              )
            }
            return (
              <MessageBubble
                message={item.message}
                mine={item.mine}
                showAuthor={item.showAuthor}
                onLongPress={
                  item.mine && !item.message.deletedAt
                    ? () => confirmDelete(item.message)
                    : undefined
                }
              />
            )
          }}
        />
      )}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor={colors.textDisabled}
          multiline
          maxLength={MAX_CHAT_BODY_LENGTH}
          accessibilityLabel="Message"
        />
        <Pressable
          style={[styles.send, !draft.trim() && styles.sendDisabled]}
          onPress={submit}
          disabled={!draft.trim()}
          accessibilityRole="button"
          accessibilityLabel="Send"
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

function Body({ body, mine }: { body: string; mine: boolean }) {
  return (
    <Text style={[styles.body, mine && styles.bodyMine]}>
      {splitMentions(body).map((seg, i) =>
        seg.kind === 'text' ? (
          seg.text
        ) : (
          <Text key={i} style={[styles.mention, mine && styles.bodyMine]}>
            @{seg.name}
          </Text>
        ),
      )}
    </Text>
  )
}

function MessageBubble({
  message,
  mine,
  showAuthor,
  onLongPress,
}: {
  message: ChatMessage
  mine: boolean
  showAuthor: boolean
  onLongPress?: () => void
}) {
  const deleted = message.deletedAt != null || message.body == null
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      {!mine ? (
        <View style={[styles.avatar, !showAuthor && styles.avatarHidden]}>
          {showAuthor ? (
            <Text style={styles.avatarText}>{initials(message.author.name)}</Text>
          ) : null}
        </View>
      ) : null}
      <Pressable
        onLongPress={onLongPress}
        style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
        accessibilityHint={onLongPress ? 'Long press to delete' : undefined}
      >
        {showAuthor ? <Text style={styles.author}>{message.author.name}</Text> : null}
        {deleted ? (
          <Text style={[styles.deleted, mine && styles.bodyMine]}>Message deleted</Text>
        ) : (
          <Body body={message.body as string} mine={mine} />
        )}
        <Text style={[styles.time, mine && styles.timeMine]}>{formatClock(message.createdAt)}</Text>
      </Pressable>
    </View>
  )
}

function PendingBubble({
  pending,
  onRetry,
  onDiscard,
}: {
  pending: PendingMessage
  onRetry: () => void
  onDiscard: () => void
}) {
  const label =
    pending.status === 'sending'
      ? 'Sending…'
      : pending.status === 'queued'
        ? 'Waiting for signal'
        : 'Not sent'
  return (
    <View style={[styles.row, styles.rowMine]}>
      <View style={styles.pendingWrap}>
        <View style={[styles.bubble, styles.bubbleMine, styles.bubblePending]}>
          <Body body={pending.body} mine />
        </View>
        <View style={styles.pendingActions}>
          <Text style={[styles.pendingLabel, pending.status === 'failed' && styles.failed]}>
            {label}
          </Text>
          {pending.status !== 'sending' ? (
            <>
              <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.action}>Retry</Text>
              </Pressable>
              <Pressable onPress={onDiscard} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.action}>Discard</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  list: { padding: spacing.md },
  emptyWrap: {
    // The list is inverted, so flip the empty state back upright.
    transform: [{ scaleY: -1 }],
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: { fontSize: fontSize.medium, color: colors.textSecondary, textAlign: 'center' },
  day: {
    alignSelf: 'center',
    marginVertical: spacing.sm,
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', marginVertical: 2 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.borderDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  avatarHidden: { backgroundColor: 'transparent' },
  avatarText: { fontSize: fontSize.small, fontWeight: '700', color: colors.textPrimary },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.xl,
  },
  bubbleMine: { backgroundColor: colors.primary },
  bubbleTheirs: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubblePending: { opacity: 0.6 },
  author: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 2,
  },
  body: { fontSize: fontSize.large, color: colors.textPrimary },
  bodyMine: { color: colors.textLight },
  mention: { fontWeight: '700', color: colors.info },
  deleted: { fontSize: fontSize.medium, fontStyle: 'italic', color: colors.textSecondary },
  time: { fontSize: 12, color: colors.textSecondary, marginTop: 2, alignSelf: 'flex-end' },
  timeMine: { color: colors.textDisabled },
  pendingWrap: { alignItems: 'flex-end', maxWidth: '78%' },
  pendingActions: { flexDirection: 'row', gap: spacing.md, marginTop: 2 },
  pendingLabel: { fontSize: fontSize.small, color: colors.textSecondary },
  failed: { color: colors.error },
  action: { fontSize: fontSize.small, fontWeight: '700', color: colors.info },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 140,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderDark,
    borderRadius: borderRadius.xl,
    fontSize: fontSize.large,
    color: colors.textPrimary,
  },
  send: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primary,
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: colors.textLight, fontSize: fontSize.large, fontWeight: '700' },
})
