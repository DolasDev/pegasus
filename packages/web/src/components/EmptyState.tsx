import type { ReactNode } from 'react'
import { InboxIcon } from 'lucide-react'

type EmptyStateProps = {
  title?: string
  description?: string
  action?: ReactNode
}

export function EmptyState({
  title = 'No results',
  description = 'Nothing to show here yet.',
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <InboxIcon className="h-10 w-10 text-muted-foreground/50" />
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
