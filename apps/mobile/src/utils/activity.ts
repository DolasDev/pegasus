import type { ActivityItem } from '../types/activity'

// ---------------------------------------------------------------------------
// Activity list grouping: consecutive items with one group key collapse into a
// single row ("3 updates on #4242"), led by the newest. Items without a group
// key always stand alone.
// ---------------------------------------------------------------------------

export interface ActivityRow {
  key: string
  /** The newest item in the group — its title, time and deep link. */
  lead: ActivityItem
  items: ActivityItem[]
  unread: boolean
}

export function groupActivity(items: readonly ActivityItem[]): ActivityRow[] {
  const out: ActivityRow[] = []
  for (const item of items) {
    const prev = out.at(-1)
    if (item.groupKey && prev && prev.lead.groupKey === item.groupKey) {
      prev.items.push(item)
      prev.unread = prev.unread || item.readAt === null
    } else {
      out.push({ key: item.id, lead: item, items: [item], unread: item.readAt === null })
    }
  }
  return out
}

/** "3 updates on #4242" for a group; the item's own title otherwise. */
export function rowTitle(row: ActivityRow): string {
  if (row.items.length === 1) return row.lead.title
  const on = row.lead.entityId ? ` on #${row.lead.entityId}` : ''
  return `${row.items.length} updates${on}`
}

/** A short relative time: "now", "5m", "3h", "2d", else the date. */
export function shortAge(iso: string, now: Date = new Date()): string {
  const mins = Math.floor((now.getTime() - Date.parse(iso)) / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString()
}
