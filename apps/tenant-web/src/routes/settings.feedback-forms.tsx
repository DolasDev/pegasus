import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertCircle, ChevronDown, ChevronRight, Loader2, MessageSquareText } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  getFeedbackForm,
  listFeedbackForms,
  listFeedbackFormVersions,
  type FeedbackFormSummary,
  type FeedbackQuestion,
} from '@/api/feedback-forms'

// ---------------------------------------------------------------------------
// Read-only viewer for the tenant's feedback forms (survey definitions).
//
// Forms are AUTHORED via the pegasus-workflows SDK/CLI (`feedback-form publish`);
// this page only lists them + their versions and shows each form's questions.
// Mirrors the read-only Integrations viewer. v1 lists forms only — minted
// requests/responses are visible via the tenant's own workflow.
// ---------------------------------------------------------------------------

function QuestionRow({ question }: { question: FeedbackQuestion }) {
  const bounds =
    question.type === 'select'
      ? (question.options ?? []).join(', ')
      : [
          question.min !== undefined ? `min ${question.min}` : null,
          question.max !== undefined ? `max ${question.max}` : null,
          question.maxLength !== undefined ? `≤ ${question.maxLength} chars` : null,
        ]
          .filter(Boolean)
          .join(', ')
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2 first:border-t-0">
      <code className="font-mono text-xs text-foreground">{question.id}</code>
      <Badge variant="outline" className="text-[10px]">
        {question.type}
      </Badge>
      {question.required && (
        <Badge variant="secondary" className="text-[10px]">
          required
        </Badge>
      )}
      <span className="text-sm text-foreground">{question.label}</span>
      {bounds && <span className="text-xs text-muted-foreground">· {bounds}</span>}
    </div>
  )
}

function FormVersions({ formKey }: { formKey: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['feedback-form-versions', formKey],
    queryFn: () => listFeedbackFormVersions(formKey),
  })
  if (isPending) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading versions…
      </div>
    )
  }
  if (isError || !data) {
    return (
      <p className="py-2 text-xs text-destructive" role="alert">
        Failed to load versions.
      </p>
    )
  }
  return (
    <ul className="space-y-1 py-1">
      {data.map((v) => (
        <li key={v.id} className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="font-mono text-[10px]">
            v{v.version}
          </Badge>
          <Badge variant={v.status === 'PUBLISHED' ? 'secondary' : 'muted'} className="text-[10px]">
            {v.status.toLowerCase()}
          </Badge>
          <span>Published {new Date(v.createdAt).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  )
}

function FormCard({ form }: { form: FeedbackFormSummary }) {
  const [expanded, setExpanded] = useState(false)
  const { data: full } = useQuery({
    queryKey: ['feedback-form', form.formKey],
    queryFn: () => getFeedbackForm(form.formKey),
    enabled: expanded,
  })

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/40"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{form.title}</span>
            <code className="font-mono text-xs text-muted-foreground">{form.formKey}</code>
            <Badge variant="outline" className="font-mono text-[10px]">
              v{form.version}
            </Badge>
          </span>
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-3 pl-10">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Questions
          </h4>
          <div className="overflow-hidden rounded-md border border-border bg-background">
            {full ? (
              full.definition.questions.map((q) => <QuestionRow key={q.id} question={q} />)
            ) : (
              <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            )}
          </div>
          <h4 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Versions
          </h4>
          <FormVersions formKey={form.formKey} />
        </div>
      )}
    </div>
  )
}

export function FeedbackFormsSettingsPage() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['feedback-forms'],
    queryFn: listFeedbackForms,
  })

  return (
    <div className="container mx-auto max-w-4xl py-8">
      <PageHeader
        title="Feedback forms"
        breadcrumbs={[{ label: 'Settings' }, { label: 'Feedback forms' }]}
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquareText className="h-4 w-4" />
            About feedback forms
          </CardTitle>
          <CardDescription>
            Feedback forms are surveys you author with the Pegasus Workflows SDK/CLI (
            <code className="font-mono">feedback-form publish</code>) and publish here. A workflow
            mints a per-recipient link with{' '}
            <code className="font-mono">create_feedback_request()</code> and sends it (e.g. by SMS);
            when the recipient submits, a <code className="font-mono">feedback.submitted</code>{' '}
            event fires any workflow subscribed to it. This page is read-only.
          </CardDescription>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link to="/settings/workflows" className="text-primary hover:underline">
              Workflows
            </Link>
            <Link to="/settings/developer" className="text-primary hover:underline">
              SDK &amp; API keys
            </Link>
          </div>
        </CardHeader>
      </Card>

      {isPending && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading feedback forms…
        </div>
      )}

      {isError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error instanceof Error ? error.message : 'Failed to load feedback forms.'}</span>
        </div>
      )}

      {!isPending && !isError && (data?.length ?? 0) === 0 && (
        <EmptyState
          title="No feedback forms yet"
          description="Author a form locally with the Pegasus Workflows SDK and publish it via `pegasus-workflows feedback-form publish <key>`."
        />
      )}

      {!isPending && !isError && (data?.length ?? 0) > 0 && (
        <div className="rounded-md border border-border bg-card">
          {data!.map((form) => (
            <FormCard key={form.id} form={form} />
          ))}
        </div>
      )}
    </div>
  )
}
