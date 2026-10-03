import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getTenantUsage,
  getAutomationPlan,
  assignAutomationPlan,
  listUsageStatements,
  exportStatementCsv,
  formatCents,
  escalate,
} from '@/api/usage'
import type {
  AssignPlanInput,
  AutomationPlanCode,
  AutomationPlanRow,
  CatalogEntry,
  UsageStatement,
  UsageSummary,
} from '@/api/usage'
import { ApiError } from '@/api/client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (n: number) => n.toLocaleString('en-US')

/** termEnd is exclusive; show the last day of the term. */
function lastDay(termEnd: string): string {
  const d = new Date(`${termEnd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

const INPUT_CLASS =
  'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40'
const BUTTON_CLASS =
  'rounded-md border border-primary bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed'
const TH = 'px-2 py-1.5 text-left font-medium text-muted-foreground'
const TD = 'px-2 py-1.5'

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums" data-testid={testId}>
        {value}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary — the same view the tenant sees, compact
// ---------------------------------------------------------------------------

function SummaryPanel({ summary }: { summary: UsageSummary }) {
  const max = Math.max(1, ...summary.byMonth.map((m) => m.actions))
  return (
    <div
      className="rounded-md border border-border bg-card p-4 space-y-4"
      data-testid="usage-summary"
    >
      <p className="text-sm">
        {summary.plan ? (
          <>
            <span className="font-medium">{summary.plan.name}</span> plan · term {summary.termStart}{' '}
            – {lastDay(summary.termEnd)}
            {summary.plan.effectiveFrom !== summary.termStart && (
              <> · current plan since {summary.plan.effectiveFrom}</>
            )}
          </>
        ) : (
          <>
            No automation plan — counting calendar year {summary.termStart} –{' '}
            {lastDay(summary.termEnd)}.
          </>
        )}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Used this term" value={fmt(summary.usedTermToDate)} testId="usage-used" />
        <Stat
          label="Annual pool"
          value={summary.pool === null ? '—' : fmt(summary.pool)}
          testId="usage-pool"
        />
        <Stat
          label="Remaining"
          value={summary.remaining === null ? '—' : fmt(summary.remaining)}
          testId="usage-remaining"
        />
        <Stat label="Overage" value={fmt(summary.overageActions)} testId="usage-overage" />
        <Stat
          label="Projected at term end (estimate)"
          value={summary.projectedAtTermEnd === null ? '—' : fmt(summary.projectedAtTermEnd)}
          testId="usage-projected"
        />
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold text-muted-foreground">By month</h3>
        <ul className="space-y-1">
          {summary.byMonth.map((m) => (
            <li key={m.month} className="flex items-center gap-2 text-xs">
              <span className="w-16 tabular-nums text-muted-foreground">{m.month}</span>
              <span
                className="h-2 rounded bg-primary/60"
                style={{ width: `${(m.actions / max) * 60}%` }}
              />
              <span className="tabular-nums">{fmt(m.actions)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Action</th>
              <th className={`${TH} text-right`}>Count</th>
            </tr>
          </thead>
          <tbody>
            {summary.byAction.map((a) => (
              <tr key={a.action} className="border-b border-border/50">
                <td className={`${TD} font-mono text-xs`}>{a.action}</td>
                <td className={`${TD} text-right tabular-nums`}>{fmt(a.actions)}</td>
              </tr>
            ))}
            {summary.byAction.length === 0 && (
              <tr>
                <td className={`${TD} text-muted-foreground`} colSpan={2}>
                  No billable actions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Workflow</th>
              <th className={`${TH} text-right`}>Count</th>
            </tr>
          </thead>
          <tbody>
            {summary.byWorkflow.map((w) => (
              <tr key={w.workflowId ?? '__api__'} className="border-b border-border/50">
                <td className={TD}>
                  {w.workflowId === null
                    ? 'API clients (no workflow)'
                    : (w.workflowName ?? w.workflowId)}
                </td>
                <td className={`${TD} text-right tabular-nums`}>{fmt(w.actions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plan history
// ---------------------------------------------------------------------------

function PlanHistory({ history }: { history: AutomationPlanRow[] }) {
  if (history.length === 0) {
    return <p className="text-sm text-muted-foreground">No automation plan has been assigned.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="plan-history">
        <thead>
          <tr className="border-b border-border">
            <th className={TH}>Plan</th>
            <th className={TH}>Term start</th>
            <th className={TH}>Term end (excl.)</th>
            <th className={TH}>Effective from</th>
            <th className={`${TH} text-right`}>Monthly</th>
            <th className={`${TH} text-right`}>Pool</th>
            <th className={`${TH} text-right`}>Overage</th>
            <th className={TH}>Assigned by</th>
            <th className={TH}>Assigned</th>
          </tr>
        </thead>
        <tbody>
          {history.map((row) => (
            <tr key={row.id} className="border-b border-border/50">
              <td className={`${TD} font-medium`}>{row.planCode}</td>
              <td className={`${TD} tabular-nums`}>{row.termStart}</td>
              <td className={`${TD} tabular-nums`}>{row.termEnd}</td>
              <td className={`${TD} tabular-nums`}>{row.effectiveFrom}</td>
              <td className={`${TD} text-right tabular-nums`}>
                {formatCents(row.monthlyPriceCents)}
              </td>
              <td className={`${TD} text-right tabular-nums`}>{fmt(row.annualPoolActions)}</td>
              <td className={`${TD} text-right tabular-nums`}>
                {formatCents(row.overageCentsPerAction)}
              </td>
              <td className={TD}>{row.createdBy}</td>
              <td className={`${TD} text-xs text-muted-foreground`}>
                {new Date(row.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plan editor — new term, renewal, or mid-term upgrade
// ---------------------------------------------------------------------------

function PlanForm({
  tenantId,
  catalog,
  initialPlan,
  onAssigned,
}: {
  tenantId: string
  catalog: CatalogEntry[]
  initialPlan: AutomationPlanCode
  onAssigned: () => void
}) {
  const entryFor = (code: AutomationPlanCode) => catalog.find((e) => e.code === code) ?? catalog[0]!
  const initial = entryFor(initialPlan)

  const [planCode, setPlanCode] = useState<AutomationPlanCode>(initial.code)
  const [termStart, setTermStart] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [monthly, setMonthly] = useState(initial.monthlyPriceCents)
  const [pool, setPool] = useState(initial.annualPoolActions)
  const [overage, setOverage] = useState(initial.overageCentsPerAction)
  const [renewals, setRenewals] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function choosePlan(code: AutomationPlanCode) {
    const entry = entryFor(code)
    setPlanCode(entry.code)
    setMonthly(entry.monthlyPriceCents)
    setPool(entry.annualPoolActions)
    setOverage(entry.overageCentsPerAction)
  }

  function applyEscalator() {
    const escalated = escalate(entryFor(planCode), renewals)
    setMonthly(escalated.monthlyPriceCents)
    setOverage(escalated.overageCentsPerAction)
  }

  const mutation = useMutation({
    mutationFn: (input: AssignPlanInput) => assignAutomationPlan(tenantId, input),
    onSuccess: () => {
      setError(null)
      setSaved(true)
      onAssigned()
    },
    onError: (err) => {
      setSaved(false)
      setError(err instanceof ApiError ? err.message : 'Failed to assign the plan.')
    },
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaved(false)
    if (!/^\d{4}-\d{2}-01$/.test(termStart)) {
      setError('Term start must be the 1st of a month.')
      return
    }
    setError(null)
    mutation.mutate({
      planCode,
      termStart,
      ...(effectiveFrom ? { effectiveFrom } : {}),
      monthlyPriceCents: monthly,
      annualPoolActions: pool,
      overageCentsPerAction: overage,
    })
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-md border border-border bg-card p-4 space-y-3"
      data-testid="plan-form"
    >
      <p className="text-xs text-muted-foreground">
        A new term or renewal starts on the 1st of a month and lasts a year (any plan). Within a
        term a plan can only move up: use the term&apos;s start and set the upgrade&apos;s effective
        date — it is pro-rated by day and its pool covers the whole term.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Plan</span>
          <select
            aria-label="Plan"
            value={planCode}
            onChange={(e) => choosePlan(e.target.value as AutomationPlanCode)}
            className={INPUT_CLASS}
          >
            {catalog.map((e) => (
              <option key={e.code} value={e.code}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Term start</span>
          <input
            aria-label="Term start"
            type="date"
            value={termStart}
            onChange={(e) => setTermStart(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Effective from (upgrade only)</span>
          <input
            aria-label="Effective from (upgrade only)"
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Monthly price (cents)</span>
          <input
            aria-label="Monthly price (cents)"
            type="number"
            min={0}
            value={monthly}
            onChange={(e) => setMonthly(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Annual pool (actions)</span>
          <input
            aria-label="Annual pool (actions)"
            type="number"
            min={0}
            value={pool}
            onChange={(e) => setPool(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Overage (cents/action)</span>
          <input
            aria-label="Overage (cents/action)"
            type="number"
            min={0}
            value={overage}
            onChange={(e) => setOverage(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Renewals</span>
          <input
            aria-label="Renewals"
            type="number"
            min={0}
            max={20}
            value={renewals}
            onChange={(e) => setRenewals(Math.max(0, Math.floor(Number(e.target.value))))}
            className={`${INPUT_CLASS} w-20`}
          />
        </label>
        <button type="button" onClick={applyEscalator} className={BUTTON_CLASS}>
          Apply escalator (4% per renewal)
        </button>
        <span className="text-xs text-muted-foreground">
          {formatCents(monthly)}/month · {fmt(pool)} actions/year · {formatCents(overage)} per
          overage action
        </span>
      </div>
      <div className="flex items-center gap-3 border-t border-border pt-3">
        <button type="submit" disabled={mutation.isPending} className={BUTTON_CLASS}>
          {mutation.isPending ? 'Assigning…' : 'Assign plan'}
        </button>
        {saved && <span className="text-sm text-green-700">Plan assigned.</span>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

// ---------------------------------------------------------------------------
// Statements + CSV export
// ---------------------------------------------------------------------------

function Statements({ tenantId, statements }: { tenantId: string; statements: UsageStatement[] }) {
  const [error, setError] = useState<string | null>(null)
  const exportMutation = useMutation({
    mutationFn: (periodMonth: string) => exportStatementCsv(tenantId, periodMonth),
    onSuccess: () => setError(null),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Export failed.'),
  })

  return (
    <div className="space-y-2" data-testid="usage-statements">
      {statements.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No closed statements yet — a month closes the day after it ends.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Month</th>
              <th className={TH}>Plan</th>
              <th className={`${TH} text-right`}>Actions</th>
              <th className={`${TH} text-right`}>Overage</th>
              <th className={`${TH} text-right`}>Total</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {statements.map((s) => (
              <tr key={s.id} className="border-b border-border/50">
                <td className={`${TD} tabular-nums`}>{s.periodMonth}</td>
                <td className={TD}>{s.planCode}</td>
                <td className={`${TD} text-right tabular-nums`}>{fmt(s.actionsInMonth)}</td>
                <td className={`${TD} text-right tabular-nums`}>
                  {fmt(s.overageActions)} ({formatCents(s.overageCents)})
                </td>
                <td className={`${TD} text-right tabular-nums font-medium`}>
                  {formatCents(s.totalCents)}
                </td>
                <td className={`${TD} text-right`}>
                  <button
                    type="button"
                    onClick={() => exportMutation.mutate(s.periodMonth)}
                    disabled={exportMutation.isPending}
                    className="text-xs text-primary hover:underline disabled:opacity-40"
                  >
                    Export statement (CSV)
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section wrapper — lives inside the tenant detail page
// ---------------------------------------------------------------------------

export function TenantUsageSection({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient()

  const usage = useQuery({
    queryKey: ['usage', tenantId],
    queryFn: () => getTenantUsage(tenantId),
  })
  const plan = useQuery({
    queryKey: ['automation-plan', tenantId],
    queryFn: () => getAutomationPlan(tenantId),
  })
  const statements = useQuery({
    queryKey: ['usage-statements', tenantId],
    queryFn: () => listUsageStatements(tenantId),
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['usage', tenantId] })
    void queryClient.invalidateQueries({ queryKey: ['automation-plan', tenantId] })
  }

  const errorText = (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback

  return (
    <div className="space-y-4">
      {usage.isPending ? (
        <p className="text-sm text-muted-foreground">Loading usage…</p>
      ) : usage.isError ? (
        <p className="text-sm text-destructive">
          {errorText(usage.error, 'Failed to load usage.')}
        </p>
      ) : (
        <SummaryPanel summary={usage.data} />
      )}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Automation plan</h3>
        {plan.isPending ? (
          <p className="text-sm text-muted-foreground">Loading plan…</p>
        ) : plan.isError ? (
          <p className="text-sm text-destructive">
            {errorText(plan.error, 'Failed to load plan.')}
          </p>
        ) : (
          <>
            <PlanHistory history={plan.data.history} />
            {plan.data.catalog.length > 0 && (
              <PlanForm
                tenantId={tenantId}
                catalog={plan.data.catalog}
                initialPlan={plan.data.current?.planCode ?? plan.data.catalog[0]!.code}
                onAssigned={refresh}
              />
            )}
          </>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Monthly statements</h3>
        {statements.isPending ? (
          <p className="text-sm text-muted-foreground">Loading statements…</p>
        ) : statements.isError ? (
          <p className="text-sm text-destructive">
            {errorText(statements.error, 'Failed to load statements.')}
          </p>
        ) : (
          <Statements tenantId={tenantId} statements={statements.data} />
        )}
      </div>
    </div>
  )
}
