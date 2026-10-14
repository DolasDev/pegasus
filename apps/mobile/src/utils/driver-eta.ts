// ---------------------------------------------------------------------------
// Driver ETA helpers — which activities take an ETA, the editor's date/time
// arithmetic, and the commitment wording the driver sees.
//
// "Confirmed" (is_committed) means BOTH the driver and the shipper have
// committed to the delivery date. Every string that explains that lives here so
// the badge, the editor and the confirmation alert say the same thing.
// ---------------------------------------------------------------------------

import type { LonghaulActivity } from '../types/longhaul'

/** Delivery and Delivery to Storage (SIT-IN). Matched by CODE — SITIN and SITOUT share the `SIT` abbreviation. */
export const DRIVER_ETA_ACTIVITY_CODES = ['RDEL', 'SITIN'] as const

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})/
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Shown under the Confirmed switch — always visible, not just in the alert. */
export const COMMITMENT_EXPLANATION =
  'Only mark Confirmed after you have spoken with the shipper and you both have committed to this delivery date and arrival window.'

/** US zones offered when the activity has no stored or suggested zone. */
export const US_TIME_ZONES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'America/New_York', label: 'Eastern' },
  { id: 'America/Chicago', label: 'Central' },
  { id: 'America/Denver', label: 'Mountain' },
  { id: 'America/Phoenix', label: 'Arizona' },
  { id: 'America/Los_Angeles', label: 'Pacific' },
  { id: 'America/Anchorage', label: 'Alaska' },
  { id: 'Pacific/Honolulu', label: 'Hawaii' },
]

function typeCode(activity: LonghaulActivity): string {
  return (activity.ActivityType_code ?? activity.activityType_code ?? '').trim().toUpperCase()
}

/** True for the activities a driver may set an ETA on. */
export function isDriverEtaActivity(activity: LonghaulActivity): boolean {
  return (DRIVER_ETA_ACTIVITY_CODES as readonly string[]).includes(typeCode(activity))
}

/** Driver-facing name for the activity type. */
export function etaActivityLabel(activity: LonghaulActivity): string {
  return typeCode(activity) === 'SITIN' ? 'Delivery to Storage (SIT-IN)' : 'Delivery'
}

/** False when the type has no ETA date — the driver then sets an arrival window only. */
export function activityHasEta(activity: LonghaulActivity): boolean {
  const v = activity.activityType_isHasETA
  // Unknown (type row missing) → treat as having an ETA, the common case.
  return v == null ? true : Boolean(v)
}

/** SQL Server bits may arrive as 0/1. */
export function isCommitted(activity: LonghaulActivity): boolean {
  return Boolean(activity.is_committed)
}

/** `YYYY-MM-DD` of a legacy date value (stored as naive midnight UTC), or null. */
export function toDateOnly(value: string | null | undefined): string | null {
  if (!value) return null
  const m = DATE_ONLY_RE.exec(value.trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** Move a `YYYY-MM-DD` by whole days (UTC arithmetic — no device-zone drift). */
export function shiftDateOnly(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d! + days))
  return date.toISOString().slice(0, 10)
}

/** Today's calendar day in the device's zone, as `YYYY-MM-DD`. */
export function todayDateOnly(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** "Mon, Nov 2, 2026" for a `YYYY-MM-DD`. */
export function formatEtaDate(dateOnly: string | null | undefined): string {
  const day = toDateOnly(dateOnly ?? null)
  if (!day) return '—'
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function isValidHhMm(value: string | null | undefined): value is string {
  return typeof value === 'string' && HHMM_RE.test(value)
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h! * 60 + m!
}

/** Step an `HH:mm` by minutes, clamped to the same day (00:00–23:59). */
export function shiftHhMm(hhmm: string, deltaMinutes: number): string {
  const total = Math.min(23 * 60 + 59, Math.max(0, minutesOf(hhmm) + deltaMinutes))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** "8:00 AM" for an `HH:mm`. */
export function formatHhMm(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h! >= 12 ? 'PM' : 'AM'
  const hour12 = h! % 12 === 0 ? 12 : h! % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`
}

/** Null when the window is usable, otherwise what is wrong with it. */
export function arrivalWindowError(start: string, end: string, tz: string | null): string | null {
  if (!isValidHhMm(start) || !isValidHhMm(end)) return 'Arrival window times are invalid.'
  if (minutesOf(end) < minutesOf(start)) return 'The window must end after it starts.'
  if (!tz) return 'Choose the time zone of the delivery address.'
  return null
}

export function timeZoneLabel(tz: string | null | undefined): string {
  if (!tz) return '—'
  return US_TIME_ZONES.find((z) => z.id === tz)?.label ?? tz
}

/** "8:00 AM – 10:00 AM Central", or null when there is no window. */
export function formatArrivalWindow(
  start: string | null | undefined,
  end: string | null | undefined,
  tz: string | null | undefined,
): string | null {
  if (!isValidHhMm(start) || !isValidHhMm(end)) return null
  return `${formatHhMm(start)} – ${formatHhMm(end)}${tz ? ` ${timeZoneLabel(tz)}` : ''}`
}

/** "on Mon, Nov 2, 2026 between 8:00 AM – 10:00 AM Central" — the committed thing, in words. */
export function describeCommitment(
  date: string | null | undefined,
  window: string | null | undefined,
): string {
  const parts: string[] = []
  if (date) parts.push(`on ${formatEtaDate(date)}`)
  if (window) parts.push(`between ${window}`)
  return parts.join(' ') || 'on the scheduled date'
}

/** Alert copy for confirming an ETA that was not confirmed before. */
export function confirmAlertMessage(committedTo: string): string {
  return (
    `Confirming means both you and the shipper have committed to delivering ${committedTo}. ` +
    'Dispatch will treat this date as committed.'
  )
}

/** Alert copy for changing an ETA the shipper already agreed to. */
export function reconfirmAlertMessage(previous: string, next: string): string {
  return (
    `The shipper agreed to delivery ${previous}. You are changing it to ${next}.\n\n` +
    'Only keep it Confirmed if the shipper has agreed to the new date. Otherwise save it as not confirmed.'
  )
}
