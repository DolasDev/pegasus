import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  dismissSupportDraft,
  isDrafting,
  requestSupportDraft,
  supportKeys,
  type SupportDraft,
  type SupportTriage,
  type SupportWorkItemKind,
} from '@/api/support'

// ---------------------------------------------------------------------------
// The AI triage draft for a support thread (plan Phase 2a, D11). Only the
// operator sees it: the AI never writes to the thread. "Use as reply" copies
// the suggested reply into the reply box for the operator to edit and send.
// Approving the work item into a GitHub issue is Phase 2b.
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<SupportWorkItemKind, string> = {
  bug: 'Bug',
  investigation: 'Investigation',
  feature: 'Feature request',
  question: 'Question (no work item)',
}

const button =
  'min-h-11 rounded border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50'

export function SupportTriageCard({
  threadId,
  triage,
  onUseReply,
}: {
  threadId: string
  triage: SupportTriage | undefined
  onUseReply: (text: string) => void
}) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: supportKeys.thread(threadId) })
  const request = useMutation({
    mutationFn: () => requestSupportDraft(threadId),
    onSuccess: refresh,
  })
  const dismiss = useMutation({
    mutationFn: (draftId: string) => dismissSupportDraft(threadId, draftId),
    onSuccess: refresh,
  })

  if (!triage?.enabled) return null
  const draft = triage.draft && triage.draft.status !== 'dismissed' ? triage.draft : null
  const busy = request.isPending || dismiss.isPending
  const mutationError = request.error ?? dismiss.error

  return (
    <section
      aria-label="AI draft"
      className="space-y-3 rounded border border-dashed border-border bg-muted/40 p-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-sm font-semibold">AI draft</h2>
        <span className="text-xs text-muted-foreground">Only you see this.</span>
      </div>

      {!draft ? (
        <button type="button" className={button} disabled={busy} onClick={() => request.mutate()}>
          Draft with AI
        </button>
      ) : isDrafting(draft) ? (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          Drafting… usually under a minute.
        </p>
      ) : draft.status === 'failed' ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            The draft failed{draft.error ? `: ${draft.error}` : '.'}
          </p>
          <button type="button" className={button} disabled={busy} onClick={() => request.mutate()}>
            Try again
          </button>
        </div>
      ) : (
        <ReadyDraft
          draft={draft}
          busy={busy}
          onUseReply={onUseReply}
          onRedraft={() => request.mutate()}
          onDismiss={() => dismiss.mutate(draft.id)}
        />
      )}

      {mutationError && (
        <p role="alert" className="text-sm text-destructive">
          Couldn’t update the draft: {mutationError.message}
        </p>
      )}
    </section>
  )
}

function ReadyDraft({
  draft: d,
  busy,
  onUseReply,
  onRedraft,
  onDismiss,
}: {
  draft: SupportDraft
  busy: boolean
  onUseReply: (text: string) => void
  onRedraft: () => void
  onDismiss: () => void
}) {
  const details: [string, string | null][] = [
    ['Steps', d.reproSteps],
    ['Expected', d.expected],
    ['Actual', d.actual],
  ]
  const shown = details.filter(([, v]) => v)
  return (
    <div className="space-y-3">
      {d.stale && (
        <p className="rounded bg-background px-3 py-2 text-sm">
          New messages arrived after this draft. Re-draft to include them.
        </p>
      )}
      <div className="flex flex-wrap gap-2 text-xs">
        {d.kind && <span className="rounded bg-background px-2 py-0.5">{KIND_LABEL[d.kind]}</span>}
        {d.severity && (
          <span className="rounded bg-background px-2 py-0.5">Severity: {d.severity}</span>
        )}
      </div>
      {d.title && <p className="break-words font-medium">{d.title}</p>}
      {d.summary && <p className="whitespace-pre-wrap break-words text-sm">{d.summary}</p>}
      {shown.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Steps and expected/actual
          </summary>
          <dl className="mt-2 space-y-2">
            {shown.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="whitespace-pre-wrap break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {d.suggestedReply && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">Suggested reply</h3>
          <p className="whitespace-pre-wrap break-words rounded bg-background px-3 py-2 text-sm">
            {d.suggestedReply}
          </p>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        {d.suggestedReply && (
          <button
            type="button"
            className="min-h-11 rounded bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
            disabled={busy}
            onClick={() => onUseReply(d.suggestedReply!)}
          >
            Use as reply
          </button>
        )}
        <button type="button" className={button} disabled={busy} onClick={onRedraft}>
          Re-draft
        </button>
        <button type="button" className={button} disabled={busy} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  )
}
