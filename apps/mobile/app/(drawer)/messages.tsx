import React, { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useChat } from '../../src/chat/ChatContext'
import {
  filterEntries,
  inboxOrderNums,
  previewText,
  searchedOrderNum,
  type InboxFilter,
} from '../../src/chat/inbox'
import { displayShipper, formatListTime, routeLine } from '../../src/chat/format'
import type { ChatInboxEntry } from '../../src/services/chatService'
import { borderRadius, colors, fontSize, spacing } from '../../src/theme/colors'

// ---------------------------------------------------------------------------
// Messages — the driver's move conversations, laid out like a phone's texting
// app. Each row opens the full-screen thread (app/chat/[orderNum].tsx). The
// list is the rooms the driver follows; they follow a move's chat by opening
// it (the shipment's Chat tab) or by being @-mentioned in it.
// ---------------------------------------------------------------------------

const FILTERS: Array<{ id: InboxFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'mentions', label: 'Mentions' },
]

export default function MessagesScreen() {
  const router = useRouter()
  const { inbox, inboxLoaded, inboxError, refreshInbox, summaries, ensureSummaries } = useChat()
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const orderNums = useMemo(() => inboxOrderNums(inbox), [inbox])
  useEffect(() => ensureSummaries(orderNums), [orderNums, ensureSummaries])

  const rows = useMemo(
    () => filterEntries(inbox, filter, search, summaries),
    [inbox, filter, search, summaries],
  )
  const typedOrder = searchedOrderNum(search)
  const typedIsListed =
    typedOrder != null && rows.some((e) => Number(e.room.entityId) === typedOrder)

  const open = (orderNum: number) => router.push(`/chat/${orderNum}`)

  const onRefresh = async () => {
    setRefreshing(true)
    await refreshInbox()
    setRefreshing(false)
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder="Search order # or shipper"
          placeholderTextColor={colors.textDisabled}
          autoCorrect={false}
          accessibilityLabel="Search conversations"
        />
        <View style={styles.filters} accessibilityRole="tablist">
          {FILTERS.map((f) => (
            <Pressable
              key={f.id}
              style={[styles.chip, filter === f.id && styles.chipActive]}
              onPress={() => setFilter(f.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: filter === f.id }}
            >
              <Text style={[styles.chipText, filter === f.id && styles.chipTextActive]}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {typedOrder != null && !typedIsListed ? (
        <Pressable
          style={styles.openTyped}
          onPress={() => open(typedOrder)}
          accessibilityRole="button"
        >
          <Text style={styles.openTypedText}>Open chat for #{typedOrder}</Text>
        </Pressable>
      ) : null}

      {!inboxLoaded ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(e) => `${e.room.entityType}:${e.room.entityId}`}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={rows.length === 0 ? styles.emptyContainer : undefined}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyTitle}>
                {inboxError && inbox.length === 0 ? 'Couldn’t load messages' : 'No conversations'}
              </Text>
              <Text style={styles.emptyText}>
                {inboxError && inbox.length === 0
                  ? 'Pull down to try again.'
                  : filter === 'all' && !search
                    ? 'Open a shipment and tap its Chat tab to message the office about that move.'
                    : 'Nothing matches.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <ConversationRow
              entry={item}
              shipper={displayShipper(summaries[Number(item.room.entityId)]?.shipperName)}
              route={routeLine(summaries[Number(item.room.entityId)])}
              onPress={() => open(Number(item.room.entityId))}
            />
          )}
        />
      )}
    </View>
  )
}

function ConversationRow({
  entry,
  shipper,
  route,
  onPress,
}: {
  entry: ChatInboxEntry
  shipper: string | null
  route: string | null
  onPress: () => void
}) {
  const unread = entry.unreadCount > 0
  const last = entry.lastMessage
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Order ${entry.room.entityId}${unread ? `, ${entry.unreadCount} unread` : ''}`}
    >
      <View style={styles.rowMain}>
        <View style={styles.rowTop}>
          <Text style={[styles.title, unread && styles.bold]} numberOfLines={1}>
            #{entry.room.entityId}
            {shipper ? ` · ${shipper}` : ''}
          </Text>
          {last ? <Text style={styles.time}>{formatListTime(last.createdAt)}</Text> : null}
        </View>
        {route ? (
          <Text style={styles.route} numberOfLines={1}>
            {route}
          </Text>
        ) : null}
        <View style={styles.rowBottom}>
          <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
            {last ? `${last.authorName}: ${previewText(last.preview)}` : 'No messages yet'}
          </Text>
          {entry.unreadMentionCount > 0 ? <Text style={styles.at}>@</Text> : null}
          {unread ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{entry.unreadCount}</Text>
            </View>
          ) : null}
          {entry.muted ? <Text style={styles.muted}>Muted</Text> : null}
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  toolbar: {
    padding: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  search: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderDark,
    borderRadius: borderRadius.large,
    fontSize: fontSize.large,
    color: colors.textPrimary,
  },
  filters: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.medium, fontWeight: '600', color: colors.textPrimary },
  chipTextActive: { color: colors.textLight },
  openTyped: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.backgroundLight,
  },
  openTypedText: { fontSize: fontSize.large, fontWeight: '700', color: colors.info },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyContainer: { flexGrow: 1 },
  emptyTitle: {
    fontSize: fontSize.xlarge,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyText: { fontSize: fontSize.medium, color: colors.textSecondary, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 72,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: fontSize.large, color: colors.textPrimary },
  bold: { fontWeight: '700' },
  time: { fontSize: fontSize.small, color: colors.textSecondary },
  route: { fontSize: fontSize.small, color: colors.textSecondary },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  preview: { flex: 1, fontSize: fontSize.medium, color: colors.textSecondary },
  previewUnread: { color: colors.textPrimary, fontWeight: '600' },
  at: { fontSize: fontSize.large, fontWeight: '700', color: colors.info },
  badge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: colors.info,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: fontSize.small, fontWeight: '700', color: colors.textLight },
  muted: { fontSize: fontSize.small, color: colors.textDisabled },
})
