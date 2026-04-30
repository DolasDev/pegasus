// TODO move to server directory and have clean mechanism to share code with server

export enum TripStatus {
  PENDING = 'Pending',
  OFFERED = 'Offered',
  ACCEPTED = 'Accepted',
  IN_PROGRESS = 'In-Progress',
  FINALIZED = 'Finalized',
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
