// ---------------------------------------------------------------------------
// View A filter-bar state ⇄ saved availability-filter query.
//
// The saved shape (api/queries/availability-filters.ts) stores dates as integer
// day offsets from today — Planning's convention — so a saved "3 months back →
// 3 months ahead" window still means that next week. The date inputs hold
// `YYYY-MM-DD` strings where '' is an open bound; that round-trips as null.
//
// Day arithmetic is done on calendar dates via Date.UTC so DST never shifts an
// offset by a day. Zones are stored as codes and rehydrated to labelled options
// from the zone reference list; a code missing from the list (list not loaded
// yet, or a zone since removed) is kept as a code-labelled option so it still
// filters.
// ---------------------------------------------------------------------------

import type {
  AvailabilityMoveType,
  SavedAvailabilityQuery,
} from '@/api/queries/availability-filters'

export interface ZoneOption {
  value: string
  label: string
}

export interface MoveTypeOption {
  value: AvailabilityMoveType
  label: string
}

export type SortOrder = 'asc' | 'desc'

export interface AvailabilityFilterState {
  driverName: string
  zones: ZoneOption[]
  moveTypes: MoveTypeOption[]
  /** `YYYY-MM-DD`, or '' for an open bound. */
  dateFrom: string
  dateTo: string
  sortOrder: SortOrder | null
}

export const MOVE_TYPE_OPTIONS: MoveTypeOption[] = [
  { value: 'local', label: 'Local' },
  { value: 'longDistance', label: 'Long Dist.' },
  { value: 'shorthaul', label: 'Shorthaul' },
]

const DAY_MS = 86_400_000

/** Today's local calendar date as `YYYY-MM-DD`. */
export function localTodayIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function utcMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!)
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(utcMs(value))
}

/** Whole days from `todayIso` to `iso`; null for an open ('') or unparseable bound. */
export function toOffsetDays(iso: string, todayIso: string): number | null {
  if (!isIsoDate(iso)) return null
  return Math.round((utcMs(iso) - utcMs(todayIso)) / DAY_MS)
}

/** `YYYY-MM-DD` that is `offset` days from `todayIso`; '' for null. */
export function fromOffsetDays(offset: number | null, todayIso: string): string {
  if (offset == null) return ''
  return new Date(utcMs(todayIso) + offset * DAY_MS).toISOString().slice(0, 10)
}

export function toSavedQuery(
  state: AvailabilityFilterState,
  todayIso: string = localTodayIso(),
): SavedAvailabilityQuery {
  return {
    v: 1,
    driverName: state.driverName.trim(),
    zones: state.zones.map((z) => z.value),
    moveTypes: state.moveTypes.map((m) => m.value),
    dateFromOffsetDays: toOffsetDays(state.dateFrom, todayIso),
    dateToOffsetDays: toOffsetDays(state.dateTo, todayIso),
    sortOrder: state.sortOrder,
  }
}

export function fromSavedQuery(
  query: SavedAvailabilityQuery,
  zoneOptions: ZoneOption[],
  todayIso: string = localTodayIso(),
): AvailabilityFilterState {
  const norm = (code: string) => code.trim().toUpperCase()
  return {
    driverName: query.driverName,
    zones: query.zones.map(
      (code) =>
        zoneOptions.find((z) => norm(z.value) === norm(code)) ?? { value: code, label: code },
    ),
    moveTypes: MOVE_TYPE_OPTIONS.filter((o) => query.moveTypes.includes(o.value)),
    dateFrom: fromOffsetDays(query.dateFromOffsetDays, todayIso),
    dateTo: fromOffsetDays(query.dateToOffsetDays, todayIso),
    sortOrder: query.sortOrder,
  }
}
