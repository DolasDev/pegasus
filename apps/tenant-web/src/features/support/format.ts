import type { SupportThreadStatus } from '@pegasus/domain'

/** The customer's view of a thread's status. */
export function statusLabel(status: SupportThreadStatus): string {
  switch (status) {
    case 'awaiting_operator':
      return 'Waiting for support'
    case 'awaiting_customer':
      return 'Support replied'
    case 'resolved':
      return 'Resolved'
  }
}

/** Short time for a list row: clock time today, otherwise the date. */
export function formatSupportTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
