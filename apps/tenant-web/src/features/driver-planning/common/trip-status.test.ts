import { describe, it, expect } from 'vitest'
import { clearsDriverAvailability, TripStatus, TripStatusOptions } from './trip-status'

describe('TripStatus', () => {
  it('maps each enum member to its display label', () => {
    expect(TripStatus.PENDING).toBe('Pending')
    expect(TripStatus.OFFERED).toBe('Offered')
    expect(TripStatus.ACCEPTED).toBe('Accepted')
    expect(TripStatus.IN_PROGRESS).toBe('In-Progress')
    expect(TripStatus.FINALIZED).toBe('Finalized')
  })
})

describe('TripStatusOptions', () => {
  it('lines up status labels with sequential ids starting at 1', () => {
    expect(TripStatusOptions).toEqual([
      { status: TripStatus.PENDING, status_id: 1 },
      { status: TripStatus.OFFERED, status_id: 2 },
      { status: TripStatus.ACCEPTED, status_id: 3 },
      { status: TripStatus.IN_PROGRESS, status_id: 4 },
      { status: TripStatus.FINALIZED, status_id: 5 },
    ])
  })

  it('has unique status_ids', () => {
    const ids = TripStatusOptions.map((o) => o.status_id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('clearsDriverAvailability', () => {
  it('is true when moving from Pending/Offered into Accepted/In-Progress', () => {
    expect(clearsDriverAvailability(TripStatus.OFFERED, TripStatus.ACCEPTED)).toBe(true)
    expect(clearsDriverAvailability(TripStatus.OFFERED, TripStatus.IN_PROGRESS)).toBe(true)
    expect(clearsDriverAvailability(TripStatus.PENDING, TripStatus.ACCEPTED)).toBe(true)
    expect(clearsDriverAvailability(TripStatus.PENDING, TripStatus.IN_PROGRESS)).toBe(true)
  })

  it('is false when the driver is already confirmed or not yet confirmed', () => {
    expect(clearsDriverAvailability(TripStatus.ACCEPTED, TripStatus.IN_PROGRESS)).toBe(false)
    expect(clearsDriverAvailability(TripStatus.PENDING, TripStatus.OFFERED)).toBe(false)
    expect(clearsDriverAvailability(TripStatus.ACCEPTED, TripStatus.FINALIZED)).toBe(false)
    expect(clearsDriverAvailability(TripStatus.OFFERED, TripStatus.FINALIZED)).toBe(false)
  })

  it('is false when either status is missing', () => {
    expect(clearsDriverAvailability(undefined, TripStatus.ACCEPTED)).toBe(false)
    expect(clearsDriverAvailability(TripStatus.OFFERED, undefined)).toBe(false)
  })
})
