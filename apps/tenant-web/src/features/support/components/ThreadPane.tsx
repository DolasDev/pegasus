import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, SendHorizontal } from 'lucide-react'
import { MAX_SUPPORT_BODY_LENGTH } from '@pegasus/domain'
import {
  postSupportMessage,
  supportKeys,
  supportThreadQueryOptions,
  type SupportMessage,
  type SupportThread,
} from '@/api/queries/support'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { newClientMessageId } from '@/features/chat/thread-state'
import { cn } from '@/lib/utils'
import { formatSupportTime, statusLabel } from '../format'

// ---------------------------------------------------------------------------
// One support thread: the conversation and a reply box. Reading it marks it
// read on the server, so each successful load clears its unread flag in the
// cached list (and the nav badge). Polls every 10 s for Pegasus support's reply.
// ---------------------------------------------------------------------------

type Props = {
  threadId: string
  onBack: () => void
}

export function ThreadPane({ threadId, onBack }: Props) {
  const queryClient = useQueryClient()
  const { data, isLoading, error, dataUpdatedAt } = useQuery(supportThreadQueryOptions(threadId))

  // The GET just marked the thread read: clear its `unread` flag in the cached
  // list (and so the nav badge) without refetching the list on every poll.
  useEffect(() => {
    if (dataUpdatedAt === 0) return
    queryClient.setQueryData<SupportThread[]>(supportKeys.threads(), (list) =>
      list?.some((t) => t.id === threadId && t.unread)
        ? list.map((t) => (t.id === threadId ? { ...t, unread: false } : t))
        : list,
    )
  }, [dataUpdatedAt, queryClient, threadId])

  const bottom = useRef<HTMLDivElement>(null)
  const count = data?.messages.length ?? 0
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' })
  }, [count])

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>
  if (error || !data) {
    const gone = error instanceof ApiError && error.status === 404
    return (
      <div className="p-4">
        <BackButton onBack={onBack} />
        <p className="text-sm text-muted-foreground">
          {gone ? 'That request doesn’t exist or isn’t yours.' : 'Couldn’t load this request.'}
        </p>
      </div>
    )
  }

  const { thread, messages } = data
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b p-3">
        <BackButton onBack={onBack} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{thread.subject}</h2>
          <p className="text-xs text-muted-foreground">{statusLabel(thread.status)}</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        <div ref={bottom} />
      </div>
      {thread.status === 'resolved' && (
        <p className="border-t px-4 pt-2 text-xs text-muted-foreground">
          This request is resolved. Writing again reopens it.
        </p>
      )}
      <ReplyBox threadId={thread.id} />
    </div>
  )
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0 md:hidden"
      onClick={onBack}
      aria-label="Back to requests"
    >
      <ArrowLeft size={16} />
    </Button>
  )
}

function Bubble({ message: m }: { message: SupportMessage }) {
  const mine = m.authorKind === 'customer'
  return (
    <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      <span className="mb-0.5 text-xs text-muted-foreground">
        {mine ? 'You' : m.authorName} · {formatSupportTime(m.createdAt)}
      </span>
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm',
          mine ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )}
      >
        {m.body}
      </div>
    </div>
  )
}

/** Enter sends, Shift+Enter is a new line. One clientMessageId per draft (see NewThreadForm). */
function ReplyBox({ threadId }: { threadId: string }) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [draftId, setDraftId] = useState(newClientMessageId)

  const send = useMutation({
    mutationFn: () => postSupportMessage(threadId, { clientMessageId: draftId, body: text.trim() }),
    onSuccess: async () => {
      setText('')
      setDraftId(newClientMessageId())
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: supportKeys.thread(threadId) }),
        queryClient.invalidateQueries({ queryKey: supportKeys.threads() }),
      ])
    },
  })

  const tooLong = text.length > MAX_SUPPORT_BODY_LENGTH
  const canSend = text.trim().length > 0 && !tooLong && !send.isPending

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (canSend) send.mutate()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <form onSubmit={submit} className="border-t p-3">
      {send.isError && (
        <p role="alert" className="mb-2 text-xs text-destructive">
          Couldn’t send: {send.error.message}. Try again.
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          aria-label="Reply"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Write a reply…"
          className={cn(
            'min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            tooLong && 'border-destructive',
          )}
        />
        <Button type="submit" size="icon" disabled={!canSend} aria-label="Send reply">
          <SendHorizontal size={16} />
        </Button>
      </div>
    </form>
  )
}
