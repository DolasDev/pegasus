import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AtSign, Search } from 'lucide-react'
import { splitMentions } from '@pegasus/domain'
import {
  chatInboxQueryOptions,
  chatSummariesQueryOptions,
  type ChatInboxEntry,
  type ChatSummary,
  type InboxSource,
} from '@/api/queries/chat'
import { cn } from '@/lib/utils'
import { displayShipper, formatListTime, routeLine } from '../format'

// ---------------------------------------------------------------------------
// The left rail: conversations, newest activity first, with filters and a
// search box. Search filters the list by order number or shipper, and an
// order number opens that move's room even when nobody has posted on it yet
// (the API decides whether the caller may see it).
// ---------------------------------------------------------------------------

export type RailFilter = 'all' | 'unread' | 'mentions' | 'following'

const FILTERS: Array<{ id: RailFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'following', label: 'Following' },
]

/** Which inbox a filter reads: employees' "All" spans every room with a message. */
export function inboxSourceFor(filter: RailFilter, isEmployee: boolean): InboxSource {
  if (filter === 'following') return 'following'
  return isEmployee ? 'all' : 'following'
}

/** Applies a rail filter and the search text to inbox entries. */
export function filterEntries(
  entries: readonly ChatInboxEntry[],
  filter: RailFilter,
  search: string,
  summaries: ReadonlyMap<number, ChatSummary>,
): ChatInboxEntry[] {
  const q = search.trim().toLowerCase()
  return entries.filter((e) => {
    if (filter === 'unread' && e.unreadCount === 0) return false
    if (filter === 'mentions' && e.unreadMentionCount === 0) return false
    if (!q) return true
    if (e.room.entityId.startsWith(q.replace(/^#/, ''))) return true
    const shipper = summaries.get(Number(e.room.entityId))?.shipperName?.toLowerCase() ?? ''
    return shipper.includes(q)
  })
}

/** An order number typed into search, if it is one ("#123" or "123"). */
export function searchedOrderNum(search: string): number | null {
  const m = /^#?\s*([1-9]\d{0,9})$/.exec(search.trim())
  if (!m) return null
  const n = Number(m[1])
  return n <= 2147483647 ? n : null
}

type Props = {
  isEmployee: boolean
  selected: number | null
  onOpen: (orderNum: number) => void
}

export function ConversationList({ isEmployee, selected, onOpen }: Props) {
  const [filter, setFilter] = useState<RailFilter>('all')
  const [search, setSearch] = useState('')
  const inbox = useQuery(chatInboxQueryOptions(inboxSourceFor(filter, isEmployee)))
  const entries = useMemo(() => inbox.data ?? [], [inbox.data])

  const orderNums = useMemo(
    () => entries.map((e) => Number(e.room.entityId)).filter((n) => Number.isInteger(n)),
    [entries],
  )
  const summariesQuery = useQuery(chatSummariesQueryOptions(orderNums))
  const summaries = useMemo(
    () => new Map((summariesQuery.data ?? []).map((s) => [s.orderNum, s])),
    [summariesQuery.data],
  )

  const visible = filterEntries(entries, filter, search, summaries)
  const typedOrder = searchedOrderNum(search)
  const typedIsListed =
    typedOrder != null && entries.some((e) => Number(e.room.entityId) === typedOrder)

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b p-3">
        <h1 className="text-lg font-semibold">Messages</h1>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            if (typedOrder != null) {
              onOpen(typedOrder)
              setSearch('')
            }
          }}
        >
          <label className="relative block">
            <span className="sr-only">Search conversations</span>
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Order # or shipper"
              className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </form>
        <div className="flex gap-1" role="tablist" aria-label="Filter conversations">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'rounded-full px-3 py-1 text-xs transition-colors',
                filter === f.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {typedOrder != null && !typedIsListed && (
          <button
            type="button"
            onClick={() => {
              onOpen(typedOrder)
              setSearch('')
            }}
            className="flex w-full items-center gap-2 border-b px-3 py-3 text-left text-sm hover:bg-accent"
          >
            <Search size={14} className="text-muted-foreground" />
            Open chat for order #{typedOrder}
          </button>
        )}
        {inbox.isLoading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
        {inbox.isError && (
          <p className="p-4 text-sm text-destructive">Couldn’t load conversations.</p>
        )}
        {!inbox.isLoading && !inbox.isError && visible.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            {entries.length === 0
              ? 'No conversations yet. Search an order number to start one.'
              : 'Nothing matches this filter.'}
          </p>
        )}
        <ul>
          {visible.map((e) => {
            const orderNum = Number(e.room.entityId)
            const s = summaries.get(orderNum)
            const unread = e.unreadCount > 0
            return (
              <li key={`${e.room.entityType}/${e.room.entityId}`}>
                <button
                  type="button"
                  onClick={() => onOpen(orderNum)}
                  aria-current={selected === orderNum ? 'true' : undefined}
                  className={cn(
                    'flex w-full flex-col gap-0.5 border-b px-3 py-2.5 text-left transition-colors',
                    selected === orderNum ? 'bg-accent' : 'hover:bg-accent/50',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn('truncate text-sm', unread && 'font-semibold')}>
                      #{orderNum}
                      {s?.shipperName && (
                        <span className="text-muted-foreground">
                          {' '}
                          · {displayShipper(s.shipperName)}
                        </span>
                      )}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {e.lastMessage ? formatListTime(e.lastMessage.createdAt) : ''}
                    </span>
                  </span>
                  {routeLine(s) && (
                    <span className="truncate text-xs text-muted-foreground">{routeLine(s)}</span>
                  )}
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'truncate text-xs',
                        unread ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {e.lastMessage
                        ? `${e.lastMessage.authorName}: ${previewText(e.lastMessage.preview)}`
                        : 'No messages yet'}
                    </span>
                    {e.unreadMentionCount > 0 && (
                      <AtSign
                        size={14}
                        className="ml-auto shrink-0 text-primary"
                        aria-label="Mentioned"
                      />
                    )}
                    {unread && (
                      <span
                        className={cn(
                          'shrink-0 rounded-full bg-primary px-1.5 text-[11px] font-medium leading-5 text-primary-foreground',
                          e.unreadMentionCount === 0 && 'ml-auto',
                        )}
                        aria-label={`${e.unreadCount} unread`}
                      >
                        {e.unreadCount > 99 ? '99+' : e.unreadCount}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

/** A preview with mention tokens shown as "@Name"; deleted messages say so. */
export function previewText(preview: string | null): string {
  if (preview == null) return 'Message deleted'
  return splitMentions(preview)
    .map((seg) => (seg.kind === 'text' ? seg.text : `@${seg.name}`))
    .join('')
}
