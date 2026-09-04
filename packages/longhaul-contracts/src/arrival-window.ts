// ---------------------------------------------------------------------------
// Arrival-window contract — shared by the API's validator and tenant-web's picker.
//
// An arrival window is the "we'll be there between 8 and 10" spread that
// customer service quotes the day before an activity. It is a LOCAL wall clock
// at the activity's address, so it only means anything alongside a time zone.
//
// This module exists so the list of zones the UI offers and the list the API
// accepts cannot drift apart: apps/api asserts that every zone its resolver can
// produce appears here, and tenant-web builds its dropdown from the same array.
// ---------------------------------------------------------------------------

/**
 * How much the server's zone suggestion can be trusted.
 *
 * `confident` — the state/province lies wholly in one zone; apply it silently.
 * `likely`    — the state/province spans two zones; a person MUST confirm.
 * `unknown`   — nothing usable on the activity; a person MUST pick.
 */
export type ArrivalWindowZoneConfidence = 'confident' | 'likely' | 'unknown'

/** The spread operations quotes unless they say otherwise. */
export const DEFAULT_ARRIVAL_WINDOW = { start: '08:00', end: '10:00' } as const

export interface ArrivalWindowTimeZone {
  /** IANA zone id — what is stored in `arrival_window_tz`. */
  id: string
  /** What a dispatcher reads in the dropdown. */
  label: string
}

/**
 * Every zone an arrival window may be stored in, in the order the picker shows
 * them: US first (roughly east to west), then territories, then Canada.
 *
 * Zones that share an offset are still listed separately where the legacy
 * address data distinguishes them — `America/Boise` and `America/Denver` agree
 * today, but they are different zones and the tz database is free to change
 * one without the other.
 */
export const ARRIVAL_WINDOW_TIME_ZONES: readonly ArrivalWindowTimeZone[] = [
  { id: 'America/New_York', label: 'Eastern — New York' },
  { id: 'America/Detroit', label: 'Eastern — Michigan' },
  { id: 'America/Indiana/Indianapolis', label: 'Eastern — Indiana' },
  { id: 'America/Chicago', label: 'Central — Chicago' },
  { id: 'America/Denver', label: 'Mountain — Denver' },
  { id: 'America/Boise', label: 'Mountain — Idaho' },
  { id: 'America/Phoenix', label: 'Arizona — no daylight saving' },
  { id: 'America/Los_Angeles', label: 'Pacific — Los Angeles' },
  { id: 'America/Anchorage', label: 'Alaska' },
  { id: 'Pacific/Honolulu', label: 'Hawaii' },
  { id: 'America/Puerto_Rico', label: 'Atlantic — Puerto Rico' },
  { id: 'Pacific/Guam', label: 'Chamorro — Guam' },
  { id: 'Pacific/Pago_Pago', label: 'Samoa' },
  { id: 'America/St_Johns', label: 'Newfoundland' },
  { id: 'America/Halifax', label: 'Atlantic — Halifax' },
  { id: 'America/Toronto', label: 'Eastern — Toronto' },
  { id: 'America/Iqaluit', label: 'Eastern — Nunavut' },
  { id: 'America/Winnipeg', label: 'Central — Winnipeg' },
  { id: 'America/Regina', label: 'Central — Saskatchewan, no daylight saving' },
  { id: 'America/Edmonton', label: 'Mountain — Edmonton' },
  { id: 'America/Vancouver', label: 'Pacific — Vancouver' },
  { id: 'America/Whitehorse', label: 'Yukon' },
]

/** Zone ids only, for membership checks. */
export const ARRIVAL_WINDOW_TIME_ZONE_IDS: readonly string[] = ARRIVAL_WINDOW_TIME_ZONES.map(
  (z) => z.id,
)

/** The dropdown label for a zone id, falling back to the id itself. */
export function arrivalWindowZoneLabel(id: string | null | undefined): string {
  if (!id) return ''
  return ARRIVAL_WINDOW_TIME_ZONES.find((z) => z.id === id)?.label ?? id
}
