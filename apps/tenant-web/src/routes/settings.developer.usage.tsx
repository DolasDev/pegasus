import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Loader2, Lock } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/EmptyState'
import { ApiError } from '@/api/client'
import type { UsageSummary } from '@/api/usage'
import { usageSummaryQueryOptions } from '@/api/queries/usage'

// ---------------------------------------------------------------------------
// Settings → Developer → Usage
//
// The tenant's billable automated actions against its automation plan: the
// plan and term, a pool meter, a by-month chart and by-action / by-workflow
// breakdowns. One request (GET /api/v1/usage/summary). No prices are shown —
// the plan is the contract; the count is what this page is for.
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<string, string> = {
  SendSms: 'Texts sent',
  SendEmail: 'Emails sent',
  UpdateTextMessage: 'Texts marked read',
  CloseTask: 'Tasks closed',
  WriteOrder: 'Orders written back',
  DeliverToExternal: 'Integration deliveries',
  CallExternal: 'Integration calls (writes)',
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

/** The API's term end is exclusive; people read a term by its last day. */
export function lastDayOf(exclusiveEnd: string): string {
  const d = new Date(`${exclusiveEnd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

const n = new Intl.NumberFormat('en-US')

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  })
}

function PlanCard({ summary }: { summary: UsageSummary }) {
  const term = `${summary.termStart} – ${lastDayOf(summary.termEnd)}`
  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan</CardTitle>
        <CardDescription>
          {summary.plan ? (
            <>
              <span className="font-medium text-foreground">{summary.plan.name}</span> · term {term}
            </>
          ) : (
            <>No automation plan assigned — usage shown for the calendar year ({term}).</>
          )}
        </CardDescription>
      </CardHeader>
    </Card>
  )
}

function PoolMeter({ summary }: { summary: UsageSummary }) {
  const { pool, usedTermToDate, remaining, overageActions, projectedAtTermEnd } = summary
  const pct = pool ? Math.min(100, (usedTermToDate / pool) * 100) : 0
  return (
    <Card data-testid="usage-meter">
      <CardHeader>
        <CardTitle>Actions this term</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">{n.format(usedTermToDate)}</span>
          {pool !== null && (
            <span className="text-sm text-muted-foreground">of {n.format(pool)} actions</span>
          )}
        </div>
        {pool !== null && (
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-label="Pool used"
            aria-valuemin={0}
            aria-valuemax={pool}
            aria-valuenow={usedTermToDate}
          >
            <div
              className={`h-full ${overageActions > 0 ? 'bg-destructive' : 'bg-primary'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          {remaining !== null && <span>{n.format(remaining)} remaining</span>}
          {overageActions > 0 && (
            <span className="text-destructive">
              {n.format(overageActions)} over the pool (billed per action)
            </span>
          )}
          {projectedAtTermEnd !== null && (
            <span>
              Projected for the term: {n.format(projectedAtTermEnd)} (estimate, straight-line from
              usage so far)
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function MonthChart({ byMonth }: { byMonth: UsageSummary['byMonth'] }) {
  const max = Math.max(1, ...byMonth.map((m) => m.actions))
  return (
    <Card>
      <CardHeader>
        <CardTitle>By month</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex h-40 items-end gap-1" role="img" aria-label="Actions by month">
          {byMonth.map((m) => (
            <div
              key={m.month}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              title={`${monthLabel(m.month)}: ${n.format(m.actions)}`}
            >
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {m.actions > 0 ? n.format(m.actions) : ''}
              </span>
              <div
                data-testid="usage-month-bar"
                className="w-full rounded-t bg-[var(--color-chart-1)]"
                style={{ height: `${(m.actions / max) * 100}%` }}
              />
              <span className="text-[10px] text-muted-foreground">{monthLabel(m.month)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function BreakdownTable({
  testId,
  title,
  heading,
  rows,
}: {
  testId: string
  title: string
  heading: string
  rows: Array<{ key: string; label: string; actions: number }>
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState title="No actions yet" description="Nothing billable this term." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{heading}</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{n.format(r.actions)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function WhatCounts() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What counts as an action</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        A billable action is a successful, first-time automated action that changes something
        outside Pegasus: a text or email sent, an inbound text marked read, a task closed, or an
        integration delivery or write. Reads, retries with the same dedup key, dry runs, failed
        calls and anything people do in Pegasus are free. See the{' '}
        <a
          href="https://pegasusmovemanager.com/#automation"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          published plans
        </a>
        .
      </CardContent>
    </Card>
  )
}

export function DeveloperUsagePage() {
  const { data, isLoading, isError, error } = useQuery(usageSummaryQueryOptions())

  let body
  if (isLoading) {
    body = (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" />
        Loading usage…
      </div>
    )
  } else if (isError && error instanceof ApiError && error.status === 403) {
    body = (
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
        <Lock size={14} className="shrink-0" />
        Usage requires the tenant admin role.
      </div>
    )
  } else if (isError || !data) {
    body = (
      <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <AlertCircle size={14} className="shrink-0" />
        Could not load usage.
      </div>
    )
  } else {
    body = (
      <>
        <PlanCard summary={data} />
        <PoolMeter summary={data} />
        <MonthChart byMonth={data.byMonth} />
        <div className="grid gap-6 md:grid-cols-2">
          <BreakdownTable
            testId="usage-by-action"
            title="By action"
            heading="Action"
            rows={data.byAction.map((a) => ({
              key: a.action,
              label: actionLabel(a.action),
              actions: a.actions,
            }))}
          />
          <BreakdownTable
            testId="usage-by-workflow"
            title="By automation"
            heading="Automation"
            rows={data.byWorkflow.map((w) => ({
              key: w.workflowId ?? '__api_clients__',
              label:
                w.workflowId === null
                  ? 'API clients (not a workflow)'
                  : (w.workflowName ?? w.workflowId),
              actions: w.actions,
            }))}
          />
        </div>
      </>
    )
  }

  return (
    <div className="container mx-auto max-w-4xl space-y-6 py-8">
      <PageHeader
        title="Usage"
        breadcrumbs={[{ label: 'Settings' }, { label: 'Developer' }, { label: 'Usage' }]}
      />
      {body}
      <WhatCounts />
    </div>
  )
}
