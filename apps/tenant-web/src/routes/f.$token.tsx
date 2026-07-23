import { useState, type FormEvent } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ApiError } from '@/api/client'
import {
  getPublicFeedbackForm,
  submitPublicFeedback,
  type FeedbackQuestion,
} from '@/api/feedback-forms'

// ---------------------------------------------------------------------------
// Public feedback form page — the capability link a customer/driver opens.
//
// Standalone (hangs off the root route, no auth). Fetches the pinned form for
// the token, renders one input per question type, and POSTs the response to the
// public endpoint. The token in the path is the only credential; the API
// resolves the tenant from it.
// ---------------------------------------------------------------------------

/** One rendered question control, wired to the response map. */
function QuestionField({
  question,
  value,
  onChange,
}: {
  question: FeedbackQuestion
  value: unknown
  onChange: (v: unknown) => void
}) {
  const label = (
    <label htmlFor={`q-${question.id}`} className="block text-sm font-medium text-foreground">
      {question.label}
      {question.required && <span className="ml-0.5 text-destructive">*</span>}
    </label>
  )

  if (question.type === 'rating') {
    const min = question.min ?? 1
    const max = question.max ?? 5
    const options = Array.from({ length: max - min + 1 }, (_, i) => min + i)
    return (
      <div>
        {label}
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={question.label}>
          {options.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={value === n}
              onClick={() => onChange(n)}
              className={`h-10 w-10 rounded-md border text-sm font-medium transition ${
                value === n
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background text-foreground hover:bg-muted'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (question.type === 'boolean') {
    return (
      <div>
        {label}
        <div className="mt-2 flex gap-2" role="group" aria-label={question.label}>
          {[
            { v: true, t: 'Yes' },
            { v: false, t: 'No' },
          ].map((opt) => (
            <button
              key={opt.t}
              type="button"
              aria-pressed={value === opt.v}
              onClick={() => onChange(opt.v)}
              className={`rounded-md border px-4 py-2 text-sm font-medium transition ${
                value === opt.v
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background text-foreground hover:bg-muted'
              }`}
            >
              {opt.t}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (question.type === 'select') {
    return (
      <div>
        {label}
        <select
          id={`q-${question.id}`}
          className="mt-2 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">Select…</option>
          {(question.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (question.type === 'number') {
    return (
      <div>
        {label}
        <input
          id={`q-${question.id}`}
          type="number"
          {...(question.min !== undefined ? { min: question.min } : {})}
          {...(question.max !== undefined ? { max: question.max } : {})}
          className="mt-2 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      </div>
    )
  }

  // text
  return (
    <div>
      {label}
      <textarea
        id={`q-${question.id}`}
        {...(question.maxLength !== undefined ? { maxLength: question.maxLength } : {})}
        className="mt-2 block h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    </div>
  )
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-lg">{children}</Card>
    </div>
  )
}

export function PublicFeedbackPage() {
  const { token } = useParams({ strict: false }) as { token: string }
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const { data, isPending, isError } = useQuery({
    queryKey: ['public-feedback', token],
    queryFn: () => getPublicFeedbackForm(token),
    retry: false,
  })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    // Drop unanswered (undefined) keys so optional questions aren't sent as null.
    const response: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(answers)) {
      if (v !== undefined && v !== '') response[k] = v
    }
    setSubmitting(true)
    try {
      await submitPublicFeedback(token, response)
      setSubmitted(true)
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(err.message || 'Could not submit your feedback.')
      } else {
        setSubmitError('Could not submit your feedback.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (isPending) {
    return (
      <CenteredCard>
        <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </CardContent>
      </CenteredCard>
    )
  }

  if (isError || !data) {
    return (
      <CenteredCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Link not found
          </CardTitle>
          <CardDescription>
            This feedback link is invalid or has expired. If you received it by text, please use the
            most recent message.
          </CardDescription>
        </CardHeader>
      </CenteredCard>
    )
  }

  if (submitted || data.status === 'submitted') {
    return (
      <CenteredCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Thank you!
          </CardTitle>
          <CardDescription>
            Your feedback has been received. You can close this page.
          </CardDescription>
        </CardHeader>
      </CenteredCard>
    )
  }

  if (data.status === 'expired') {
    return (
      <CenteredCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="h-5 w-5 text-amber-600" />
            This link has expired
          </CardTitle>
          <CardDescription>
            We&rsquo;re sorry — this feedback link is no longer active.
          </CardDescription>
        </CardHeader>
      </CenteredCard>
    )
  }

  return (
    <CenteredCard>
      <CardHeader>
        <CardTitle className="text-lg">{data.title}</CardTitle>
        <CardDescription>Your feedback helps us improve. It only takes a minute.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          {data.definition.questions.map((q) => (
            <QuestionField
              key={q.id}
              question={q}
              value={answers[q.id]}
              onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
            />
          ))}
          {submitError && (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit feedback
          </Button>
        </form>
      </CardContent>
    </CenteredCard>
  )
}
