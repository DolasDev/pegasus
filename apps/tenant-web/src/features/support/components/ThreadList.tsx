import { useQuery } from '@tanstack/react-query'
import { LifeBuoy, Plus } from 'lucide-react'
import { supportThreadsQueryOptions } from '@/api/queries/support'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatSupportTime, statusLabel } from '../format'

// ---------------------------------------------------------------------------
// My support requests, newest activity first. Only the threads I opened: the
// API never returns anyone else's.
// ---------------------------------------------------------------------------

type Props = {
  selected: string | null
  onOpen: (id: string) => void
  onNew: () => void
}

export function ThreadList({ selected, onOpen, onNew }: Props) {
  const { data, isLoading, isError } = useQuery(supportThreadsQueryOptions())
  const threads = data ?? []

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <h1 className="text-base font-semibold">Help</h1>
        <Button size="sm" onClick={onNew} className="gap-1.5">
          <Plus size={14} />
          New request
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p className="p-4 text-sm text-destructive">Couldn’t load your requests.</p>
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-6 text-center text-muted-foreground">
            <LifeBuoy size={32} className="opacity-40" />
            <p className="text-sm">No requests yet. Ask Pegasus support anything.</p>
          </div>
        ) : (
          <ul>
            {threads.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onOpen(t.id)}
                  aria-current={t.id === selected ? 'true' : undefined}
                  className={cn(
                    'flex w-full flex-col gap-0.5 border-b px-3 py-3 text-left hover:bg-muted/60',
                    t.id === selected && 'bg-muted',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn('min-w-0 flex-1 truncate text-sm', t.unread && 'font-semibold')}
                    >
                      {t.subject}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatSupportTime(t.lastMessageAt)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {t.unread && (
                      <span aria-label="Unread" className="h-2 w-2 rounded-full bg-primary" />
                    )}
                    {statusLabel(t.status)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
