/**
 * Shared mobile app types.
 *
 * Driver-facing order/trip data now comes from the longhaul endpoints — see
 * `src/types/longhaul.ts` (LonghaulTrip / LonghaulShipment). The legacy
 * cloud-`Move` "TruckingOrder" aliases were removed when the Paperwork screen
 * was retired.
 */

/** Mirrors the `data` of `GET /api/v1/me/driver/metrics`. */
export interface DriverMetrics {
  driverId: number
  asOf: string
  weekStart: string
  /** null when the trip read failed / is not configured. */
  trips: { activeShipments: number; completedThisWeek: number } | null
  /** null when the on-prem financials source is unavailable. */
  financials: DriverFinancials | null
  unavailable: { section: string; reason: string }[]
}

export interface DriverFinancials {
  runningBalance: number | null
  escrowHeld: number | null
  monthEnd: { year: number; month: number; balance: number } | null
  pendingSettlement: { total: number; count: number }
}
