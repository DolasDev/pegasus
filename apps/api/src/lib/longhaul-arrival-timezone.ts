// ---------------------------------------------------------------------------
// Time-zone resolution for a longhaul activity's arrival window.
//
// An arrival window is a LOCAL wall clock ("8:00–10:00") at the activity's
// address. To turn that into the instant an SMS should fire, the zone has to be
// known — and known correctly, because the failure mode is texting a customer
// an hour early or an hour late.
//
// So this resolver never silently guesses. It returns one of three confidences:
//
//   'confident' — the state/province lies entirely in one zone. Auto-applied.
//   'likely'    — the state/province SPANS two zones. A best guess is offered
//                 (from the ZIP3 hint table when one matches, else the state's
//                 majority zone) but the caller MUST have a human confirm it.
//   'unknown'   — no usable state/province. The caller must have a human pick.
//
// The 14 split states are AK, AZ (the Navajo Nation observes DST while the rest
// of Arizona does not), FL, ID, IN, KS, KY, MI, ND, NE, OR, SD, TN and TX.
// Canada adds BC, ON, NL and NU.
//
// WHY NOT A ZIP→ZONE PACKAGE: the published npm options are unmaintained (the
// freshest carries 2020 data) and none of them cover Canadian postal codes,
// which this tenant needs — longhaul crosses the border. A stale table that
// answers confidently is worse here than a curated one that admits what it does
// not know.
//
// WHY ZIP3 HINTS ARE ONLY HINTS: a 3-digit prefix is coarser than the zone
// boundary in several of these states (Michigan's Upper Peninsula and Indiana's
// county patchwork are not expressible at ZIP3 at all). Every hint below is
// anchored to a named city and only ever PRE-SELECTS a value a person then
// confirms — a wrong hint costs a correction, never a wrongly-timed message.
// ---------------------------------------------------------------------------

/** How much the caller may trust the returned zone. */
export type ZoneConfidence = 'confident' | 'likely' | 'unknown'

export interface ResolvedZone {
  /** IANA zone id, or null when nothing could be resolved. */
  timeZone: string | null
  confidence: ZoneConfidence
  /** Why the confidence is what it is — surfaced in the UI hint. */
  reason: string
}

/**
 * States, districts, territories and provinces that lie entirely within one
 * zone. A match here is auto-applied with no human confirmation.
 */
const SINGLE_ZONE: Record<string, string> = {
  // ---- United States, Eastern ----
  CT: 'America/New_York',
  DC: 'America/New_York',
  DE: 'America/New_York',
  GA: 'America/New_York',
  MA: 'America/New_York',
  MD: 'America/New_York',
  ME: 'America/New_York',
  NC: 'America/New_York',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NY: 'America/New_York',
  OH: 'America/New_York',
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  VA: 'America/New_York',
  VT: 'America/New_York',
  WV: 'America/New_York',
  // ---- United States, Central ----
  AL: 'America/Chicago',
  AR: 'America/Chicago',
  IA: 'America/Chicago',
  IL: 'America/Chicago',
  LA: 'America/Chicago',
  MN: 'America/Chicago',
  MO: 'America/Chicago',
  MS: 'America/Chicago',
  OK: 'America/Chicago',
  WI: 'America/Chicago',
  // ---- United States, Mountain ----
  CO: 'America/Denver',
  MT: 'America/Denver',
  NM: 'America/Denver',
  UT: 'America/Denver',
  WY: 'America/Denver',
  // ---- United States, Pacific and beyond ----
  CA: 'America/Los_Angeles',
  NV: 'America/Los_Angeles',
  WA: 'America/Los_Angeles',
  HI: 'Pacific/Honolulu',
  // ---- US territories ----
  PR: 'America/Puerto_Rico',
  VI: 'America/Puerto_Rico',
  GU: 'Pacific/Guam',
  MP: 'Pacific/Guam',
  AS: 'Pacific/Pago_Pago',
  // ---- Canada ----
  AB: 'America/Edmonton',
  MB: 'America/Winnipeg',
  NB: 'America/Halifax',
  NS: 'America/Halifax',
  PE: 'America/Halifax',
  // Saskatchewan observes Central Standard Time year-round (no DST) — which is
  // exactly why it needs its own zone id rather than America/Chicago.
  SK: 'America/Regina',
  NT: 'America/Edmonton',
  YT: 'America/Whitehorse',
  // Quebec's populated area is entirely Eastern; the Basse-Côte-Nord exception
  // (Blanc-Sablon) is a few hundred people and is caught by the ops override.
  QC: 'America/Toronto',
}

/**
 * States and provinces that SPAN two zones, with the zone most of their
 * population sits in. Never auto-applied — always confirmed by a person.
 */
const SPLIT_MAJORITY_ZONE: Record<string, string> = {
  AK: 'America/Anchorage', // Aleutians west of 169°30′W are Hawaii-Aleutian.
  AZ: 'America/Phoenix', // The Navajo Nation observes DST; the rest does not.
  FL: 'America/New_York', // Panhandle west of the Apalachicola River is Central.
  ID: 'America/Boise', // Northern panhandle is Pacific.
  IN: 'America/Indiana/Indianapolis', // NW + SW counties are Central.
  KS: 'America/Chicago', // Four western counties are Mountain.
  KY: 'America/New_York', // Western Kentucky is Central.
  MI: 'America/Detroit', // Four western UP counties are Central.
  ND: 'America/Chicago', // Southwestern counties are Mountain.
  NE: 'America/Chicago', // The panhandle is Mountain.
  OR: 'America/Los_Angeles', // Malheur County is Mountain.
  SD: 'America/Chicago', // West-river counties are Mountain.
  TN: 'America/Chicago', // East Tennessee is Eastern.
  TX: 'America/Chicago', // El Paso and Hudspeth counties are Mountain.
  BC: 'America/Vancouver', // The Peace River and Kootenay areas are Mountain.
  ON: 'America/Toronto', // Northwestern Ontario is Central.
  NL: 'America/St_Johns', // Most of Labrador is Atlantic.
  NU: 'America/Iqaluit', // Nunavut spans three zones.
}

/**
 * ZIP3 → zone, for prefixes inside a split state that are anchored on a city
 * known to be in the state's MINORITY zone. Improves the pre-selection only;
 * the caller still confirms. Absent prefixes fall back to the state majority.
 */
const ZIP3_HINTS: Record<string, string> = {
  // Texas — El Paso (798) and its outlying county (799) are Mountain.
  '798': 'America/Denver',
  '799': 'America/Denver',
  // Florida panhandle — Panama City (324) and Pensacola (325) are Central.
  '324': 'America/Chicago',
  '325': 'America/Chicago',
  // Oregon — Ontario, Malheur County (979) keeps Mountain time with Idaho.
  '979': 'America/Boise',
  // Idaho panhandle — Lewiston (835) and Coeur d'Alene (838) are Pacific.
  '835': 'America/Los_Angeles',
  '838': 'America/Los_Angeles',
  // Arizona — Window Rock / Chinle (865) sit in the Navajo Nation, which does
  // observe DST, so they track Denver rather than Phoenix.
  '865': 'America/Denver',
  // South Dakota — Rapid City (577) is west-river Mountain.
  '577': 'America/Denver',
  // Tennessee — Chattanooga (373/374) and Knoxville (377/378/379) are Eastern.
  '373': 'America/New_York',
  '374': 'America/New_York',
  '377': 'America/New_York',
  '378': 'America/New_York',
  '379': 'America/New_York',
}

/** A Canadian postal code starts letter-digit-letter (e.g. `M5V 3A8`). */
const CANADIAN_POSTAL_RE = /^[A-Za-z]\d[A-Za-z]/

/** Every zone this resolver can produce — the ops override picks from these. */
export const SELECTABLE_TIME_ZONES: readonly string[] = [
  ...new Set([
    ...Object.values(SINGLE_ZONE),
    ...Object.values(SPLIT_MAJORITY_ZONE),
    ...Object.values(ZIP3_HINTS),
  ]),
].sort()

/** The 3-digit prefix of a US ZIP, or null for anything that isn't one. */
export function zip3Of(zip: unknown): string | null {
  if (typeof zip !== 'string' && typeof zip !== 'number') return null
  const raw = String(zip).trim()
  // Canadian postal codes are not ZIPs — don't slice letters into a prefix.
  if (CANADIAN_POSTAL_RE.test(raw)) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 5) return null
  return digits.slice(0, 3)
}

/**
 * Resolve the IANA zone for an activity's address.
 *
 * Reads only `state` and `zip`, both of which every activity carries (they are
 * copied from the shipment's `shipper_*` / `consignee_*` columns by
 * `longhaul-build-activities`). Pure — no I/O, no clock.
 */
export function resolveTimeZone(location: { zip?: unknown; state?: unknown }): ResolvedZone {
  const state = typeof location.state === 'string' ? location.state.trim().toUpperCase() : ''

  const single = SINGLE_ZONE[state]
  if (single) {
    return {
      timeZone: single,
      confidence: 'confident',
      reason: `${state} is entirely in one time zone`,
    }
  }

  const majority = SPLIT_MAJORITY_ZONE[state]
  if (majority) {
    const prefix = zip3Of(location.zip)
    const hinted = prefix ? ZIP3_HINTS[prefix] : undefined
    if (hinted) {
      return {
        timeZone: hinted,
        confidence: 'likely',
        reason: `${state} spans two time zones; ZIP ${prefix}xx is in ${hinted.split('/').pop()?.replace(/_/g, ' ')}`,
      }
    }
    return {
      timeZone: majority,
      confidence: 'likely',
      reason: `${state} spans two time zones — confirm this is right for this address`,
    }
  }

  return {
    timeZone: null,
    confidence: 'unknown',
    reason: state
      ? `No time zone known for state/province "${state}"`
      : 'The activity has no state or province on it',
  }
}
