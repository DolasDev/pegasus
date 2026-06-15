import { getApiClient } from '../api/client'
import { logger } from '../utils/logger'
import type {
  DriverMapping,
  LonghaulTrip,
  LonghaulTripDetail,
  LonghaulShipment,
} from '../types/longhaul'

// ---------------------------------------------------------------------------
// Trip service — sources the driver "My Trips" experience entirely from the
// existing cloud operations (longhaul) endpoints, plus the small /me/driver
// mapping endpoint for identity. No new data endpoints; mirrors the data the
// tenant-web operations module shows.
// ---------------------------------------------------------------------------

const PENDING_STATUS = 'pending'
const CANCELED_INTERNAL = 'canceled'

/** Status name (case-insensitive) that flags a trip queued for the driver. */
export const OFFERED_STATUS = 'offered'

export class TripService {
  /**
   * Resolve the longhaul driver id mapped to the logged-in user (set by a
   * tenant admin). Returns null when unmapped — the UI then shows an
   * onboarding empty state instead of an arbitrary tenant-wide trip list.
   */
  static async getDriverId(): Promise<number | null> {
    const client = getApiClient()
    const res = await client.fetch<DriverMapping>('/api/v1/me/driver')
    return res?.longhaulDriverId ?? null
  }

  /**
   * Fetch the trips assigned to a driver, filtered server-side by driver_id
   * and sorted by planned start date. Pending and canceled trips are excluded
   * client-side so the result is exactly "any status other than pending or
   * canceled" regardless of how the legacy internal_status is encoded.
   */
  static async getMyTrips(driverId: number): Promise<LonghaulTrip[]> {
    const client = getApiClient()
    const query = {
      filters: { driver_id: { value: driverId } },
      sortBy: { value: 'planned_first_day', order: 'desc' },
    }
    const path = `/api/v1/onprem/longhaul/trips?filters=${encodeURIComponent(JSON.stringify(query))}`
    const trips = await client.fetch<LonghaulTrip[]>(path)
    return (trips ?? []).filter(isVisibleTrip)
  }

  /** Fetch a single trip with its embedded shipments. */
  static async getTrip(tripId: string | number): Promise<LonghaulTripDetail | null> {
    const client = getApiClient()
    return client.fetch<LonghaulTripDetail>(`/api/v1/onprem/longhaul/trips/${tripId}`)
  }

  /**
   * Fetch the full enriched detail for one shipment — the exact source the
   * tenant-web ShipmentDetail panel uses (searchTerm == order number).
   */
  static async getShipment(orderNum: string | number): Promise<LonghaulShipment | null> {
    const client = getApiClient()
    const path = `/api/v1/onprem/longhaul/shipments?searchTerm=${encodeURIComponent(String(orderNum))}`
    try {
      const rows = await client.fetch<LonghaulShipment[]>(path)
      if (!rows?.length) return null
      const exact = rows.find((s) => String(s.order_num) === String(orderNum))
      return exact ?? rows[0]
    } catch (error) {
      logger.warn('Failed to fetch shipment detail', error)
      throw error
    }
  }
}

/** True when a trip should appear in the driver's list (not pending, not canceled). */
export function isVisibleTrip(trip: LonghaulTrip): boolean {
  const status = (trip.status_status ?? '').trim().toLowerCase()
  const internal = (trip.internal_status ?? '').trim().toLowerCase()
  return status !== PENDING_STATUS && internal !== CANCELED_INTERNAL
}

/** True when a trip is in the "Offered" status awaiting the driver's attention. */
export function isOfferedTrip(trip: LonghaulTrip): boolean {
  return (trip.status_status ?? '').trim().toLowerCase() === OFFERED_STATUS
}
