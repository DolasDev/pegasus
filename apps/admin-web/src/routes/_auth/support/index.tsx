import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  INBOX_POLL_MS,
  listSupportThreads,
  supportKeys,
  type SupportInboxFilter,
  type SupportStatus,
} from '@/api/support'

// ---------------------------------------------------------------------------
// Support inbox: every tenant's threads, newest activity first. Built for a
// phone first (Steve answers from the alert email): one column, whole-row tap
// targets, no table.
// ---------------------------------------------------------------------------

const FILTERS: { label: string; value: SupportInboxFilter }[] = [
  { label: 'Open', value: 'open' },
  { label: 'Needs reply', value: 'awaiting_operator' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'All', value: 'all' },
]

export const STATUS_LABEL: Record<SupportStatus, string> = {
  awaiting_operator: 'Needs reply',
  awaiting_customer: 'Waiting on customer',
  resolved: 'Resolved',
}

const STATUS_STYLE: Record<SupportStatus, string> = {
  awaiting_operator: 'bg-amber-100 text-amber-800',
  awaiting_customer: 'bg-blue-50 text-blue-700',
  resolved: 'bg-neutral-100 text-neutral-600',
}

export function StatusPill({ status }: { status: SupportStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

export function formatWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function SupportInboxPage() {
  const [filter, setFilter] = useState<SupportInboxFilter>('open')
  const { data, isPending, isError, error } = useQuery({
    queryKey: supportKeys.inbox(filter),
    queryFn: () => listSupportThreads(filter),
    refetchInterval: INBOX_POLL_MS,
  })
  const threads = data ?? []

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Support</h1>

      <div role="tablist" aria-label="Filter threads" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={
              filter === f.value
                ? 'min-h-10 rounded-full bg-foreground px-4 text-sm font-medium text-background'
                : 'min-h-10 rounded-full border border-border px-4 text-sm text-muted-foreground hover:bg-muted'
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : isError ? (
        <p className="text-sm text-destructive">Couldn’t load the inbox: {error.message}</p>
      ) : threads.length === 0 ? (
        <p className="rounded border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nothing here.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border bg-card">
          {threads.map((t) => (
            <li key={t.id}>
              <Link
                to="/support/$id"
                params={{ id: t.id }}
                className="flex min-h-16 flex-col gap-1 px-4 py-3 hover:bg-muted/60"
              >
                <span className="flex items-center gap-2">
                  {t.unread && (
                    <span
                      aria-label="Unread"
                      className="h-2 w-2 shrink-0 rounded-full bg-primary"
                    />
                  )}
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${t.unread ? 'font-semibold' : ''}`}
                  >
                    {t.subject}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatWhen(t.lastMessageAt)}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">
                    {t.tenant.name} · {t.openedBy.name}
                  </span>
                  <StatusPill status={t.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
