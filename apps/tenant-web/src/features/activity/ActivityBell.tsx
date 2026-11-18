// ---------------------------------------------------------------------------
// The header bell: unseen count, and a panel of recent Activity (task queue
// plan, Phase 2b). Only the count polls; the list loads when the panel opens.
// Opening the panel clears the count (seen); clicking a row marks it read and
// opens its screen (activityLink).
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  activityListQueryOptions,
  unseenCountQueryOptions,
  useMarkActivityRead,
  useMarkActivitySeen,
  useMarkAllActivityRead,
  type ActivityItem,
} from '@/api/queries/activity'
import { activityLink } from './link'

function age(iso: string, now = Date.now()): string {
  const mins = Math.floor((now - Date.parse(iso)) / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function ActivityBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { data: unseen = 0 } = useQuery(unseenCountQueryOptions)
  const list = useQuery({ ...activityListQueryOptions, enabled: open })
  const markSeen = useMarkActivitySeen()
  const markRead = useMarkActivityRead()
  const markAll = useMarkAllActivityRead()

  // Close on an outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && unseen > 0) markSeen.mutate()
  }

  function openItem(item: ActivityItem) {
    if (!item.readAt) markRead.mutate(item.id)
    const link = activityLink(item.data)
    setOpen(false)
    if (link) void navigate(link)
  }

  const items = list.data ?? []
  const anyUnread = items.some((i) => !i.readAt)

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="sm"
        className="relative"
        onClick={toggle}
        aria-label={unseen > 0 ? `Activity, ${unseen} new` : 'Activity'}
        aria-expanded={open}
        data-testid="activity-bell"
      >
        <Bell size={16} />
        {unseen > 0 && (
          <span
            className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-destructive px-1 text-center text-[11px] font-semibold leading-[18px] text-destructive-foreground"
            data-testid="activity-unseen"
          >
            {unseen > 99 ? '99+' : unseen}
          </span>
        )}
      </Button>
      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-96 rounded-md border bg-background shadow-lg"
          role="dialog"
          aria-label="Activity"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Activity</span>
            <div className="flex items-center gap-3 text-xs">
              {anyUnread && (
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => markAll.mutate()}
                >
                  Mark all read
                </button>
              )}
              <Link
                to="/notifications/settings"
                className="text-primary hover:underline"
                onClick={() => setOpen(false)}
              >
                Settings
              </Link>
            </div>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {list.isLoading && <li className="p-3 text-sm text-muted-foreground">Loading…</li>}
            {list.isError && (
              <li className="p-3 text-sm text-destructive">Couldn’t load Activity.</li>
            )}
            {!list.isLoading && !list.isError && items.length === 0 && (
              <li className="p-3 text-sm text-muted-foreground">No activity yet.</li>
            )}
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`flex w-full gap-2 border-b px-3 py-2 text-left hover:bg-muted ${item.readAt ? '' : 'bg-muted/40'}`}
                  onClick={() => openItem(item)}
                  data-testid={`activity-item-${item.id}`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? 'bg-transparent' : 'bg-primary'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-sm ${item.readAt ? '' : 'font-semibold'}`}
                    >
                      {item.title}
                    </span>
                    <span className="block text-xs text-muted-foreground line-clamp-2">
                      {item.body}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {age(item.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
