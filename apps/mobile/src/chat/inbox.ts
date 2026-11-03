import { splitMentions } from '@pegasus/domain'
import type { ChatInboxEntry, ChatSummary } from '../services/chatService'

// Pure helpers for the Messages screen, ported from tenant-web's
// ConversationList. The driver app has no "Following" filter: its inbox is
// already the rooms it follows (plus unread mentions).

export type InboxFilter = 'all' | 'unread' | 'mentions'

/** Applies a filter and the search text (order number prefix or shipper name). */
export function filterEntries(
  entries: readonly ChatInboxEntry[],
  filter: InboxFilter,
  search: string,
  summaries: Readonly<Record<number, ChatSummary>>,
): ChatInboxEntry[] {
  const q = search.trim().toLowerCase()
  return entries.filter((e) => {
    if (filter === 'unread' && e.unreadCount === 0) return false
    if (filter === 'mentions' && e.unreadMentionCount === 0) return false
    if (!q) return true
    if (e.room.entityId.startsWith(q.replace(/^#/, ''))) return true
    const shipper = summaries[Number(e.room.entityId)]?.shipperName?.toLowerCase() ?? ''
    return shipper.includes(q)
  })
}

/** A search that is an order number ("4242" or "#4242"), or null. */
export function searchedOrderNum(search: string): number | null {
  const m = /^#?\s*([1-9]\d{0,9})$/.exec(search.trim())
  if (!m) return null
  const n = Number(m[1])
  return n <= 2147483647 ? n : null
}

/** A list preview with mention tokens shown as "@Name". */
export function previewText(preview: string | null): string {
  if (preview == null) return 'Message deleted'
  return splitMentions(preview)
    .map((seg) => (seg.kind === 'text' ? seg.text : `@${seg.name}`))
    .join('')
}

/** Order numbers in the list, for one summaries batch. */
export function inboxOrderNums(entries: readonly ChatInboxEntry[]): number[] {
  return entries.map((e) => Number(e.room.entityId)).filter((n) => Number.isInteger(n) && n > 0)
}
