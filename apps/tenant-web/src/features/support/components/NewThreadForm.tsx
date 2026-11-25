import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { MAX_SUPPORT_BODY_LENGTH, MAX_SUPPORT_SUBJECT_LENGTH } from '@pegasus/domain'
import { openSupportThread, supportKeys } from '@/api/queries/support'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { newClientMessageId } from '@/features/chat/thread-state'
import { supportContext } from '../context'

// ---------------------------------------------------------------------------
// Open a support request. The subject is required: Steve's alert email carries
// the subject, and without one the API would use the message's first line,
// which puts the message text in the email.
//
// One clientMessageId per draft, not per click: a retry after a network error
// (or a double tap) replays the same request instead of opening a second
// thread. A new id is drawn only after the thread is created.
// ---------------------------------------------------------------------------

type Props = {
  onCreated: (threadId: string) => void
  /** Shown below the `md` breakpoint, where the form is its own screen. */
  onBack?: () => void
}

export function NewThreadForm({ onCreated, onBack }: Props) {
  const queryClient = useQueryClient()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [draftId, setDraftId] = useState(newClientMessageId)

  const open = useMutation({
    mutationFn: () =>
      openSupportThread({
        clientMessageId: draftId,
        subject: subject.trim(),
        body: body.trim(),
        context: supportContext(),
      }),
    onSuccess: async ({ thread }) => {
      setSubject('')
      setBody('')
      setDraftId(newClientMessageId())
      await queryClient.invalidateQueries({ queryKey: supportKeys.threads() })
      onCreated(thread.id)
    },
  })

  const subjectOk = subject.trim().length > 0 && subject.length <= MAX_SUPPORT_SUBJECT_LENGTH
  const bodyOk = body.trim().length > 0 && body.length <= MAX_SUPPORT_BODY_LENGTH
  const canSend = subjectOk && bodyOk && !open.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    if (canSend) open.mutate()
  }

  return (
    <form onSubmit={submit} className="mx-auto flex h-full max-w-2xl flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        {onBack && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 md:hidden"
            onClick={onBack}
            aria-label="Back to requests"
          >
            <ArrowLeft size={16} />
          </Button>
        )}
        <h2 className="text-lg font-semibold">New support request</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        A bug, a question, or something you’d like Pegasus to do. Pegasus support will reply here,
        and you’ll see it in your Activity feed.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="support-subject">Subject</Label>
        <Input
          id="support-subject"
          value={subject}
          maxLength={MAX_SUPPORT_SUBJECT_LENGTH}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. Trip dates show the wrong day"
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col space-y-1.5">
        <Label htmlFor="support-body">What’s going on?</Label>
        <textarea
          id="support-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          className="min-h-40 w-full flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="What you were doing, what you expected, and what happened instead."
        />
        <p
          className={
            body.length > MAX_SUPPORT_BODY_LENGTH
              ? 'text-xs text-destructive'
              : 'text-xs text-muted-foreground'
          }
        >
          {body.length}/{MAX_SUPPORT_BODY_LENGTH} · The page you were on and your browser are
          attached.
        </p>
      </div>
      {open.isError && (
        <p role="alert" className="text-sm text-destructive">
          Couldn’t send: {open.error.message}. Try again.
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={!canSend}>
          {open.isPending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </form>
  )
}
