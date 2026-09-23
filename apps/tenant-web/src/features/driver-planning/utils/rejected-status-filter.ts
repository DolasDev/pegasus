// ---------------------------------------------------------------------------
// The Trips screen's Status filter carries one option that is NOT a legacy
// `MasterTripStatus` row: "Rejected".
//
// Rejected trips are immutable snapshots stored cloud-side in Postgres
// (ArchivedTrip, see #290) — deliberately never written back to the tenant's
// on-prem MSSQL, whose LongDistanceDispatchActivity triggers must not re-fire.
// So the option is synthetic: the dropdown appends it client-side, and it must
// be stripped out of the query before it reaches `GET /trips`. `TripStatus_id`
// is an int column and the handler binds each selected value into
// `TripStatus_id IN (@p0, ...)`, so letting the sentinel through would fail the
// MSSQL int conversion and 500 the WHOLE trips list — not just the rejected
// part. Hence the split happens in the fetchTrips thunk (the single choke
// point), not in the container.
// ---------------------------------------------------------------------------

/** Sentinel `TripStatus_id` value for the synthetic "Rejected" option. */
export const REJECTED_STATUS_VALUE = 'REJECTED'

export const REJECTED_STATUS_OPTION = {
  value: REJECTED_STATUS_VALUE,
  label: 'Rejected',
}

interface SplitResult {
  /** The query with the sentinel removed — safe to send to `GET /trips`. */
  liveQuery: any
  /** "Rejected" was one of the selected statuses. */
  includesRejected: boolean
  /** "Rejected" was the ONLY selected status — no live trip matches it. */
  onlyRejected: boolean
}

function isRejectedOption(option: any): boolean {
  return String(option?.value ?? option) === REJECTED_STATUS_VALUE
}

/**
 * Split a trips query into the live-trip query and the rejected-snapshot flags.
 *
 * `onlyRejected` matters because stripping the sentinel from a single-selection
 * status list leaves an EMPTY list, which the handler reads as "no status
 * filter" — it would return the TOP 100 of everything. The caller short-circuits
 * on this flag instead of fetching a list it means to hide.
 */
export function splitRejectedStatus(query: any): SplitResult {
  const statuses = query?.filters?.TripStatus_id
  if (!Array.isArray(statuses) || !statuses.some(isRejectedOption)) {
    return { liveQuery: query, includesRejected: false, onlyRejected: false }
  }

  const liveStatuses = statuses.filter((option: any) => !isRejectedOption(option))
  return {
    liveQuery: {
      ...query,
      filters: { ...query.filters, TripStatus_id: liveStatuses },
    },
    includesRejected: true,
    onlyRejected: liveStatuses.length === 0,
  }
}
