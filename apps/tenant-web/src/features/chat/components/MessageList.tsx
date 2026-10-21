import { Fragment, useEffect, useLayoutEffect, useRef } from 'react'
import { AlertCircle, Trash2 } from 'lucide-react'
import { splitMentions } from '@pegasus/domain'
import type { ChatMessage } from '@/api/queries/chat'
import { cn } from '@/lib/utils'
import { dayKey, dayLabel, formatClock, initials } from '../format'
import type { PendingMessage } from '../thread-state'

// ---------------------------------------------------------------------------
// The thread: bubbles grouped by author (mine on the right), day dividers, an
// unread line where this visit's new messages start, and a "load older" control
// at the top. Sticks to the bottom as messages arrive unless the reader has
// scrolled up.
// ---------------------------------------------------------------------------

type Props = {
  messages: readonly ChatMessage[]
  pending: readonly PendingMessage[]
  myUserId: string | null
  /** Messages after this (from others) sit below the "New" line. */
  unreadAfter: string | null
  hasOlder: boolean
  loadingOlder: boolean
  canDeleteAny: boolean
  onLoadOlder: () => void
  onRetry: (clientMessageId: string) => void
  onDiscard: (clientMessageId: string) => void
  onDelete: (messageId: string) => void
}

/** Renders a body with its mentions highlighted. */
export function MessageBody({ body, myUserId }: { body: string; myUserId: string | null }) {
  return (
    <>
      {splitMentions(body).map((seg, i) =>
        seg.kind === 'text' ? (
          <Fragment key={i}>{seg.text}</Fragment>
        ) : (
          <span
            key={i}
            className={cn(
              'rounded px-0.5 font-medium',
              seg.userId === myUserId ? 'bg-amber-200 text-amber-950' : 'text-primary',
            )}
          >
            @{seg.name}
          </span>
        ),
      )}
    </>
  )
}

const GROUP_GAP_MS = 5 * 60_000

export function MessageList({
  messages,
  pending,
  myUserId,
  unreadAfter,
  hasOlder,
  loadingOlder,
  canDeleteAny,
  onLoadOlder,
  onRetry,
  onDiscard,
  onDelete,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const firstId = messages[0]?.id
  const prevFirstId = useRef<string | undefined>(firstId)
  const prevHeight = useRef(0)

  const firstUnread = unreadAfter
    ? messages.find((m) => m.createdAt > unreadAfter && m.author.id !== myUserId)?.id
    : messages.find((m) => m.author.id !== myUserId)?.id

  // Older messages were prepended: keep the reader's place.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (prevFirstId.current && firstId !== prevFirstId.current && !atBottom.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current
    }
    prevFirstId.current = firstId
    prevHeight.current = el.scrollHeight
  }, [firstId])

  // New messages at the bottom: follow them if the reader was already there.
  useEffect(() => {
    const el = scroller.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
    if (el) prevHeight.current = el.scrollHeight
  }, [messages.length, pending.length])

  let lastDay = ''
  return (
    <div
      ref={scroller}
      className="flex-1 overflow-y-auto px-4 py-3"
      onScroll={(e) => {
        const el = e.currentTarget
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
      aria-live="polite"
    >
      {hasOlder && (
        <div className="mb-3 flex justify-center">
          <button
            type="button"
            onClick={onLoadOlder}
            disabled={loadingOlder}
            className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            {loadingOlder ? 'Loading…' : 'Load older messages'}
          </button>
        </div>
      )}
      {messages.length === 0 && pending.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No messages yet. Say something to start the conversation.
        </p>
      )}
      <ol className="space-y-0.5">
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const mine = m.author.id === myUserId
          const day = dayKey(m.createdAt)
          const newDay = day !== lastDay
          lastDay = day
          const grouped =
            !newDay &&
            prev?.author.id === m.author.id &&
            new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_GAP_MS &&
            m.id !== firstUnread
          return (
            <Fragment key={m.id}>
              {newDay && (
                <li
                  className="my-3 flex items-center gap-3 text-xs text-muted-foreground"
                  role="separator"
                >
                  <span className="h-px flex-1 bg-border" />
                  {dayLabel(m.createdAt)}
                  <span className="h-px flex-1 bg-border" />
                </li>
              )}
              {m.id === firstUnread && (
                <li
                  className="my-2 flex items-center gap-3 text-xs font-medium text-red-600"
                  role="separator"
                >
                  <span className="h-px flex-1 bg-red-300" />
                  New
                  <span className="h-px flex-1 bg-red-300" />
                </li>
              )}
              <li
                className={cn('group flex gap-2', mine && 'flex-row-reverse', !grouped && 'mt-3')}
              >
                <div className="w-8 shrink-0">
                  {!grouped && !mine && (
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium"
                      aria-hidden
                    >
                      {initials(m.author.name)}
                    </span>
                  )}
                </div>
                <div
                  className={cn('flex max-w-[75%] flex-col', mine ? 'items-end' : 'items-start')}
                >
                  {!grouped && (
                    <span className="mb-0.5 text-xs text-muted-foreground">
                      {mine ? 'You' : m.author.name} · {formatClock(m.createdAt)}
                    </span>
                  )}
                  <div className="flex items-center gap-1">
                    {(mine || canDeleteAny) && m.body != null && (
                      <button
                        type="button"
                        onClick={() => onDelete(m.id)}
                        className={cn(
                          'invisible rounded p-1 text-muted-foreground hover:text-destructive group-hover:visible focus:visible',
                          !mine && 'order-last',
                        )}
                        aria-label="Delete message"
                        title="Delete message"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    <div
                      className={cn(
                        'whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm',
                        m.body == null
                          ? 'border italic text-muted-foreground'
                          : mine
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted',
                      )}
                      title={grouped ? formatClock(m.createdAt) : undefined}
                    >
                      {m.body == null ? (
                        'Message deleted'
                      ) : (
                        <MessageBody body={m.body} myUserId={myUserId} />
                      )}
                    </div>
                  </div>
                </div>
              </li>
            </Fragment>
          )
        })}
        {pending.map((p) => (
          <li key={p.clientMessageId} className="mt-1 flex flex-row-reverse gap-2">
            <div className="w-8 shrink-0" />
            <div className="flex max-w-[75%] flex-col items-end">
              <div
                className={cn(
                  'whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm',
                  p.status === 'failed'
                    ? 'border border-destructive bg-background'
                    : 'bg-primary/70 text-primary-foreground',
                )}
              >
                <MessageBody body={p.body} myUserId={myUserId} />
              </div>
              {p.status === 'sending' ? (
                <span className="mt-0.5 text-xs text-muted-foreground">Sending…</span>
              ) : (
                <span className="mt-0.5 flex items-center gap-2 text-xs text-destructive">
                  <AlertCircle size={12} /> Not sent
                  <button
                    type="button"
                    className="underline"
                    onClick={() => onRetry(p.clientMessageId)}
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground underline"
                    onClick={() => onDiscard(p.clientMessageId)}
                  >
                    Discard
                  </button>
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
