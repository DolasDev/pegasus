import type { ChatSummary } from '@/api/queries/chat'

// Display helpers for the chat page. `now` is injectable so tests are stable.

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** A message's time of day, e.g. "3:04 PM". */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** The conversation list's timestamp: a time today, otherwise a short date. */
export function formatListTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (sameDay(d, now)) return formatClock(iso)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString(undefined, opts)
}

/** The divider between days in a thread: "Today", "Yesterday" or a date. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (sameDay(d, now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return 'Yesterday'
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString(undefined, opts)
}

/** The local calendar day of an instant, for grouping. */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** Up to two initials for an avatar ("Ann Lee" → "AL", "ops@x.test" → "O"). */
export function initials(name: string): string {
  const base = name.includes('@') ? (name.split('@')[0] ?? name) : name
  const words = base
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w))
  const letters = words.slice(0, 2).map((w) => w.replace(/[^A-Za-z0-9]/g, '')[0] ?? '')
  return letters.join('').toUpperCase() || '?'
}

/** A legacy calendar date ("2026-10-21") as "Oct 21". */
export function formatShortDate(ymd: string | null): string | null {
  if (!ymd) return null
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** "Austin, TX → Denver, CO", or whichever side is known. */
export function routeLine(s: ChatSummary | undefined): string | null {
  if (!s) return null
  if (s.origin && s.destination) return `${s.origin} → ${s.destination}`
  return s.origin ?? s.destination ?? null
}

/** Title-cases a legacy upper-case name ("SMITH, JOHN" → "Smith, John"). */
export function displayShipper(name: string | null | undefined): string | null {
  if (!name) return null
  if (name !== name.toUpperCase()) return name
  return name
    .toLowerCase()
    .replace(/(^|[\s,'-])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase())
}
