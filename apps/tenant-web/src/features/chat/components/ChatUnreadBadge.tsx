import { useQuery } from '@tanstack/react-query'
import { chatInboxQueryOptions } from '@/api/queries/chat'
import { cn } from '@/lib/utils'

/** Total unread across the conversations I follow (mentions auto-follow). */
export function useChatUnreadTotal(): number {
  const { data } = useQuery({ ...chatInboxQueryOptions('following'), retry: false })
  return (data ?? []).reduce((sum, e) => sum + e.unreadCount, 0)
}

/** The nav item's unread count; renders nothing at zero. */
export function ChatUnreadBadge({ collapsed }: { collapsed: boolean }) {
  const total = useChatUnreadTotal()
  if (total === 0) return null
  const label = total > 99 ? '99+' : String(total)
  return (
    <span
      aria-label={`${total} unread messages`}
      className={cn(
        'rounded-full bg-primary text-[10px] font-semibold leading-4 text-primary-foreground',
        collapsed ? 'absolute right-1 top-1 min-w-4 px-1 text-center' : 'ml-auto px-1.5',
      )}
    >
      {label}
    </span>
  )
}
