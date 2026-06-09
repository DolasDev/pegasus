// TODO move to server directory and have clean mechanism to share code with server

export enum TripStatus {
  PENDING = 'Pending',
  OFFERED = 'Offered',
  ACCEPTED = 'Accepted',
  IN_PROGRESS = 'In-Progress',
  FINALIZED = 'Finalized',
}

// A trip moving from Pending/Offered into Accepted/In-Progress confirms the
// driver, which invalidates (and server-side clears) their manually-entered
// ready availability. The Trips screen uses this to warn before the change.
const PRE_CONFIRM_STATUSES = new Set<TripStatus>([TripStatus.PENDING, TripStatus.OFFERED])
const CONFIRMED_STATUSES = new Set<TripStatus>([TripStatus.ACCEPTED, TripStatus.IN_PROGRESS])

export function clearsDriverAvailability(from?: TripStatus, to?: TripStatus): boolean {
  return !!from && !!to && PRE_CONFIRM_STATUSES.has(from) && CONFIRMED_STATUSES.has(to)
}

export const TripStatusOptions = [
  {
    status: TripStatus.PENDING,
    status_id: 1,
  },
  {
    status: TripStatus.OFFERED,
    status_id: 2,
  },
  {
    status: TripStatus.ACCEPTED,
    status_id: 3,
  },
  {
    status: TripStatus.IN_PROGRESS,
    status_id: 4,
  },
  {
    status: TripStatus.FINALIZED,
    status_id: 5,
  },
]
