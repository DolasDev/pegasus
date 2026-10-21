import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Bell, BellOff, Star } from 'lucide-react'
import { ApiError } from '@pegasus/api-http'
import {
  chatMentionableQueryOptions,
  chatRoomQueryOptions,
  chatSummariesQueryOptions,
  useUpdateChatMembership,
} from '@/api/queries/chat'
import { cn } from '@/lib/utils'
import { displayShipper, formatShortDate, routeLine } from '../format'
import { useChatThread } from '../useChatThread'
import { Composer } from './Composer'
import { MessageList } from './MessageList'

// ---------------------------------------------------------------------------
// One move's conversation: header (order, shipper, route, dates, drivers,
// follow/mute), the thread and the composer. Mount it keyed by order number.
// ---------------------------------------------------------------------------

type Props = {
  orderNum: number
  myUserId: string | null
  isAdmin: boolean
  /** Shown below the list/thread breakpoint to go back to the list. */
  onBack: () => void
}

function accessMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'You don’t have access to this move’s chat.'
    if (err.status === 404) return 'That order wasn’t found.'
    if (err.status === 422)
      return 'Chat needs the legacy database, which isn’t configured for this company.'
  }
  return 'Couldn’t load this conversation. Try again in a moment.'
}

export function ConversationPane({ orderNum, myUserId, isAdmin, onBack }: Props) {
  const room = useQuery(chatRoomQueryOptions(orderNum))
  const mentionable = useQuery({
    ...chatMentionableQueryOptions(orderNum),
    enabled: room.isSuccess,
  })
  const summary = useQuery(chatSummariesQueryOptions([orderNum]))
  const thread = useChatThread(orderNum)
  const membership = useUpdateChatMembership(orderNum)

  // Where this visit's "New" line goes: the read cursor as it was on arrival,
  // before this visit advanced it.
  const [unreadAfter, setUnreadAfter] = useState<string | null | undefined>(undefined)
  if (unreadAfter === undefined && room.data) {
    setUnreadAfter(room.data.membership?.lastReadAt ?? null)
  }

  const s = summary.data?.find((x) => x.orderNum === orderNum)
  const drivers = (mentionable.data ?? []).filter((m) => m.kind === 'driver')
  const following = room.data?.membership?.following ?? false
  const muted = room.data?.membership?.muted ?? false
  const error = room.error ?? thread.error
  const dates = [
    ['Pack', formatShortDate(s?.packDate ?? null)],
    ['Load', formatShortDate(s?.loadDate ?? null)],
    ['Deliver', formatShortDate(s?.deliveryDate ?? null)],
  ].filter((d): d is [string, string] => d[1] != null)

  return (
    <section className="flex h-full min-w-0 flex-col" aria-label={`Chat for order ${orderNum}`}>
      <header className="flex items-start gap-3 border-b px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 mt-0.5 rounded p-1 hover:bg-accent md:hidden"
          aria-label="Back to conversations"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">
            #{orderNum}
            {s?.shipperName && (
              <span className="font-normal"> · {displayShipper(s.shipperName)}</span>
            )}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {[routeLine(s), dates.map(([k, v]) => `${k} ${v}`).join(' · ')]
              .filter(Boolean)
              .join('  •  ') || (summary.isError ? 'Move details unavailable' : ' ')}
          </p>
          {drivers.length > 0 && (
            <p className="truncate text-xs text-muted-foreground">
              Drivers: {drivers.map((d) => d.name).join(', ')}
            </p>
          )}
        </div>
        {room.isSuccess && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => membership.mutate({ following: !following })}
              disabled={membership.isPending}
              aria-pressed={following}
              className={cn(
                'flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent',
                following && 'border-primary text-primary',
              )}
              title={
                following
                  ? 'Stop following: no notifications unless mentioned'
                  : 'Follow: get notified of new messages'
              }
            >
              <Star size={14} className={following ? 'fill-current' : ''} />
              {following ? 'Following' : 'Follow'}
            </button>
            <button
              type="button"
              onClick={() => membership.mutate({ muted: !muted })}
              disabled={membership.isPending}
              aria-pressed={muted}
              className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
              title={muted ? 'Unmute' : 'Mute: only mentions notify you'}
            >
              {muted ? <BellOff size={14} /> : <Bell size={14} />}
              {muted ? 'Muted' : 'Mute'}
            </button>
          </div>
        )}
      </header>

      {error ? (
        <p className="p-6 text-sm text-muted-foreground" role="alert">
          {accessMessage(error)}
        </p>
      ) : !thread.state.loaded ? (
        <p className="p-6 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <MessageList
          messages={thread.state.messages}
          pending={thread.state.pending}
          myUserId={myUserId}
          unreadAfter={unreadAfter ?? null}
          hasOlder={thread.state.hasOlder}
          loadingOlder={thread.loadingOlder}
          canDeleteAny={isAdmin}
          onLoadOlder={() => void thread.loadOlder()}
          onRetry={thread.retry}
          onDiscard={thread.discard}
          onDelete={(id) => {
            if (window.confirm('Delete this message for everyone?')) void thread.remove(id)
          }}
        />
      )}
      <Composer
        mentionable={mentionable.data ?? []}
        disabled={!!error || !room.isSuccess}
        onSend={thread.send}
      />
    </section>
  )
}
