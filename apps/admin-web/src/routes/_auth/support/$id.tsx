import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { ApiError } from '@/api/client'
import { SupportTriageCard } from '@/components/SupportTriageCard'
import {
  DRAFTING_POLL_MS,
  MAX_SUPPORT_BODY_LENGTH,
  THREAD_POLL_MS,
  isDrafting,
  getSupportThread,
  newClientMessageId,
  replyToSupportThread,
  setSupportThreadStatus,
  supportKeys,
  type SupportMessage,
  type SupportStatus,
  type SupportThreadDetail,
} from '@/api/support'
import { StatusPill, formatWhen } from './index'

// ---------------------------------------------------------------------------
// One support thread, as the operator: who asked (tenant, user, the page they
// were on), the conversation, a reply box and resolve / reopen. Single column
// with large controls, since this is usually opened from the alert email on a
// phone. Replying notifies the customer in their Activity feed. Where AI
// triage is on (staging), an AI draft card sits above the reply box; "Use as
// reply" copies its suggested reply into the box for the operator to edit.
// ---------------------------------------------------------------------------

export function SupportThreadPage() {
  const { id } = useParams({ strict: false }) as { id: string }
  const queryClient = useQueryClient()
  const { data, isPending, error } = useQuery({
    queryKey: supportKeys.thread(id),
    queryFn: () => getSupportThread(id),
    refetchInterval: (q) =>
      isDrafting(q.state.data?.triage?.draft) ? DRAFTING_POLL_MS : THREAD_POLL_MS,
    retry: false,
  })
  // Lifted so the AI draft card can fill it.
  const [reply, setReply] = useState('')
  // Never throws away what the operator already typed: append instead.
  const fillReply = (text: string) => {
    setReply((current) => (current.trim() ? `${current.trimEnd()}\n\n${text}` : text))
    const box = document.getElementById('support-reply')
    box?.focus()
    box?.scrollIntoView?.({ block: 'center' })
  }

  // Opening the thread marked it read: the inbox's unread dots are stale.
  const loaded = data !== undefined
  useEffect(() => {
    if (loaded) void queryClient.invalidateQueries({ queryKey: [...supportKeys.all, 'inbox'] })
  }, [loaded, queryClient])

  const bottom = useRef<HTMLDivElement>(null)
  const count = data?.messages.length ?? 0
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' })
  }, [count])

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        to="/support"
        className="inline-flex min-h-10 items-center text-sm text-muted-foreground hover:text-foreground"
      >
        ← Inbox
      </Link>
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error || !data ? (
        <p className="text-sm text-destructive">
          {error instanceof ApiError && error.status === 404
            ? 'Thread not found.'
            : `Couldn’t load the thread: ${error?.message ?? 'unknown error'}`}
        </p>
      ) : (
        <>
          <ThreadHeader thread={data.thread} />
          <div className="space-y-3">
            {data.messages.map((m) => (
              <Bubble key={m.id} message={m} />
            ))}
            <div ref={bottom} />
          </div>
          <SupportTriageCard
            threadId={data.thread.id}
            triage={data.triage}
            onUseReply={fillReply}
          />
          <ReplyBox threadId={data.thread.id} text={reply} setText={setReply} />
          <StatusActions thread={data.thread} />
        </>
      )}
    </div>
  )
}

function ThreadHeader({ thread: t }: { thread: SupportThreadDetail }) {
  return (
    <div className="space-y-2 rounded border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <h1 className="min-w-0 flex-1 break-words text-lg font-semibold">{t.subject}</h1>
        <StatusPill status={t.status} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Tenant</dt>
        <dd>
          <Link
            to="/tenants/$id"
            params={{ id: t.tenant.id }}
            className="underline-offset-2 hover:underline"
          >
            {t.tenant.name}
          </Link>
        </dd>
        <dt className="text-muted-foreground">From</dt>
        <dd className="break-all">
          {t.openedBy.name}
          {t.openedBy.email ? ` · ${t.openedBy.email}` : ''}
        </dd>
        {t.pageUrl && (
          <>
            <dt className="text-muted-foreground">Page</dt>
            <dd className="break-all">{t.pageUrl}</dd>
          </>
        )}
        {t.appVersion && (
          <>
            <dt className="text-muted-foreground">Version</dt>
            <dd>{t.appVersion}</dd>
          </>
        )}
        {t.userAgent && (
          <>
            <dt className="text-muted-foreground">Browser</dt>
            <dd className="break-all text-xs text-muted-foreground">{t.userAgent}</dd>
          </>
        )}
      </dl>
    </div>
  )
}

function Bubble({ message: m }: { message: SupportMessage }) {
  const operator = m.authorKind === 'operator'
  return (
    <div className={`flex flex-col ${operator ? 'items-end' : 'items-start'}`}>
      <span className="mb-0.5 text-xs text-muted-foreground">
        {m.authorName} · {formatWhen(m.createdAt)}
      </span>
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${
          operator ? 'bg-foreground text-background' : 'bg-muted'
        }`}
      >
        {m.body}
      </div>
    </div>
  )
}

/** One clientMessageId per draft: a retry after an error can't post the reply twice. */
function ReplyBox({
  threadId,
  text,
  setText,
}: {
  threadId: string
  text: string
  setText: (text: string) => void
}) {
  const queryClient = useQueryClient()
  const [draftId, setDraftId] = useState(newClientMessageId)

  const send = useMutation({
    mutationFn: () =>
      replyToSupportThread(threadId, { clientMessageId: draftId, body: text.trim() }),
    onSuccess: async () => {
      setText('')
      setDraftId(newClientMessageId())
      await queryClient.invalidateQueries({ queryKey: supportKeys.all })
    },
  })

  const tooLong = text.length > MAX_SUPPORT_BODY_LENGTH
  const canSend = text.trim().length > 0 && !tooLong && !send.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    if (canSend) send.mutate()
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="support-reply" className="text-sm font-medium">
        Reply
      </label>
      <textarea
        id="support-reply"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className={`w-full rounded border bg-background px-3 py-2 text-base sm:text-sm ${
          tooLong ? 'border-destructive' : 'border-border'
        }`}
        placeholder="The customer sees this in Pegasus, from “Pegasus support”."
      />
      {tooLong && (
        <p className="text-xs text-destructive">
          {text.length}/{MAX_SUPPORT_BODY_LENGTH} characters
        </p>
      )}
      {send.isError && (
        <p role="alert" className="text-sm text-destructive">
          Couldn’t send: {send.error.message}. Try again.
        </p>
      )}
      <button
        type="submit"
        disabled={!canSend}
        className="min-h-11 w-full rounded bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50 sm:w-auto"
      >
        {send.isPending ? 'Sending…' : 'Send reply'}
      </button>
    </form>
  )
}

function StatusActions({ thread }: { thread: SupportThreadDetail }) {
  const queryClient = useQueryClient()
  const change = useMutation({
    mutationFn: (status: SupportStatus) => setSupportThreadStatus(thread.id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: supportKeys.all }),
  })
  const resolved = thread.status === 'resolved'
  // Reopening puts it back in "Needs reply": the operator owes the next move.
  const next: SupportStatus = resolved ? 'awaiting_operator' : 'resolved'

  return (
    <div className="space-y-2 border-t border-border pt-4">
      {change.isError && (
        <p role="alert" className="text-sm text-destructive">
          Couldn’t update: {change.error.message}
        </p>
      )}
      <button
        type="button"
        disabled={change.isPending}
        onClick={() => change.mutate(next)}
        className="min-h-11 w-full rounded border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50 sm:w-auto"
      >
        {resolved ? 'Reopen' : 'Mark resolved'}
      </button>
    </div>
  )
}
