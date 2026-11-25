import { useQuery } from '@tanstack/react-query'
import { supportThreadsQueryOptions } from '@/api/queries/support'
import { cn } from '@/lib/utils'

/** Threads with a reply from Pegasus support that I haven't opened yet. */
export function useSupportUnreadCount(): number {
  const { data } = useQuery({ ...supportThreadsQueryOptions(), retry: false })
  return (data ?? []).filter((t) => t.unread).length
}

/** The Help nav item's badge; renders nothing at zero. */
export function SupportUnreadBadge({ collapsed }: { collapsed: boolean }) {
  const count = useSupportUnreadCount()
  if (count === 0) return null
  return (
    <span
      aria-label={`${count} unread support ${count === 1 ? 'reply' : 'replies'}`}
      className={cn(
        'rounded-full bg-primary text-[10px] font-semibold leading-4 text-primary-foreground',
        collapsed ? 'absolute right-1 top-1 min-w-4 px-1 text-center' : 'ml-auto px-1.5',
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
